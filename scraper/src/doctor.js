// Per-provider "levels of access" diagnostic (issue #110).
//
// This is an OPERATOR tool, not a CI gate. It runs escalating checks so a
// break can be pinned to an exact layer instead of collapsing to a useless
// generic-error:
//
//   L0 config    — provider is known and its fields match the library (no network)
//   L1 egress    — TLS-connect each host the provider's scraper uses (no browser)
//   L2 anti-bot  — the hardened browser reaches the real login page, not a WAF block
//   L3 wrong-creds — dummy credentials classify as wrong-credentials, not a timeout
//   L4 full scrape — real credentials return transactions (opt-in, real secrets)
//
// Run it where the sidecar actually runs (the deploy host / container) — that's
// where L1/L2 results are meaningful. In GitHub Actions it's an early-warning
// trend signal only (see .github/workflows/scraper-probes.yml), never a
// required check: runner IPs differ from the deploy host and bank WAFs
// geo/datacenter-filter, so a red L2 from CI may just be runner-IP reputation.
//
//   node src/doctor.js                     # all providers, up to L2
//   node src/doctor.js --provider visaCal --level 3
//   node src/doctor.js --json              # machine-readable matrix
//   node src/doctor.js --level 4 --provider visaCal   # needs PROBE_CREDS_visaCal
//
// L4 credentials come from env: PROBE_CREDS_<provider> holding a JSON object of
// the provider's login fields, e.g.
//   PROBE_CREDS_visaCal='{"username":"...","password":"..."}'
import { readFileSync } from "node:fs";
import tls from "node:tls";

import { CompanyTypes, SCRAPERS, createScraper } from "israeli-bank-scrapers";

import { LAUNCH_ARGS, mapLibraryErrorType, preparePage } from "./app.js";

export const LEVELS = ["L0", "L1", "L2", "L3", "L4"];

// Text a WAF/CDN block page shows instead of the real login page. Cal's
// "Request Rejected" is the exact string the #109 regression produced.
export const DEFAULT_BLOCK_MARKERS = [
  "Request Rejected",
  "Access Denied",
  "The requested URL was rejected",
  "Attention Required",
];

function loadJson(relPath) {
  return JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));
}

// ── pure helpers (unit-tested in test/doctor.test.js) ────────────────────────

export function parseArgs(argv) {
  const args = { provider: null, level: 2, json: false, timeoutMs: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--level") args.level = Number(argv[++i]);
    else if (a === "--timeout") args.timeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(args.level) || args.level < 0 || args.level > 4) {
    throw new Error(`--level must be an integer 0-4, got ${args.level}`);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`--timeout must be a positive number of ms`);
  }
  return args;
}

// Which providers to probe, validated against the shared manifest.
export function selectProviders(providers, requested) {
  const known = Object.keys(providers);
  if (!requested) return known;
  if (!known.includes(requested)) {
    throw new Error(`Unknown provider '${requested}'. Known: ${known.join(", ")}`);
  }
  return [requested];
}

// L0: provider known to the library and its login fields match the manifest.
// Pure — no network — so it always runs and pins library-drift breakage first.
export function checkConfig(companyId, manifestFields, companyTypes = CompanyTypes, scrapers = SCRAPERS) {
  if (!Object.values(companyTypes).includes(companyId)) {
    return { ok: false, detail: `not a CompanyTypes value` };
  }
  const libraryFields = scrapers[companyId]?.loginFields;
  if (!libraryFields) {
    return { ok: false, detail: `no SCRAPERS metadata` };
  }
  const a = [...manifestFields].sort();
  const b = [...libraryFields].sort();
  if (a.length !== b.length || a.some((f, i) => f !== b[i])) {
    return { ok: false, detail: `fields [${manifestFields}] ≠ library [${libraryFields}]` };
  }
  return { ok: true, detail: "" };
}

// The highest contiguous level reached: results run L0..Ln and stop at the
// first non-pass, so the report is "reached L2" rather than a sparse grid.
export function highestReached(levelResults) {
  let reached = -1;
  for (let i = 0; i < LEVELS.length; i++) {
    const r = levelResults[LEVELS[i]];
    if (r && r.status === "pass") reached = i;
    else break;
  }
  return reached;
}

// Exit non-zero if any selected provider didn't reach the requested level.
// A "skip" (e.g. L4 without creds) is not a failure — it's simply not asserted.
export function computeExitCode(reports, requestedLevel) {
  for (const report of reports) {
    for (let i = 0; i <= requestedLevel; i++) {
      const r = report.levels[LEVELS[i]];
      if (r && r.status === "fail") return 1;
    }
  }
  return 0;
}

export function formatMatrix(reports, requestedLevel) {
  const cell = (r) => {
    if (!r) return "·";
    if (r.status === "pass") return "✅";
    if (r.status === "fail") return "❌";
    return "–"; // skipped
  };
  const header = ["provider", ...LEVELS.slice(0, requestedLevel + 1)];
  const rows = reports.map((rep) => [
    rep.provider,
    ...LEVELS.slice(0, requestedLevel + 1).map((lvl) => cell(rep.levels[lvl])),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => String(row[i]).length)),
  );
  const fmtRow = (row) => row.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  const lines = [fmtRow(header), fmtRow(widths.map((w) => "-".repeat(w)))];
  for (const row of rows) lines.push(fmtRow(row));
  return lines.join("\n");
}

// ── network checks (exercised live by the probe workflow) ────────────────────

// L1: a bare TLS handshake to :443. Isolates "can this host even be reached"
// (firewall / geo-block / DNS) from anything browser- or auth-related.
export function tlsConnect(host, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: timeoutMs },
      () => {
        socket.end();
        resolve({ host, ok: true });
      },
    );
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ host, ok: false, error: "timeout" });
    });
    socket.on("error", (err) => resolve({ host, ok: false, error: err.code || err.message }));
  });
}

async function checkEgress(probe, timeoutMs) {
  const results = await Promise.all(probe.egressHosts.map((h) => tlsConnect(h, timeoutMs)));
  const unreachable = results.filter((r) => !r.ok);
  if (unreachable.length) {
    return {
      status: "fail",
      detail: unreachable.map((r) => `${r.host} (${r.error})`).join(", "),
    };
  }
  return { status: "pass", detail: `${results.length} host(s) reachable` };
}

async function checkAntiBot(probe, blockMarkers, timeoutMs) {
  // Imported lazily so L0/L1-only runs (and the unit tests) never need a
  // browser present.
  const { default: puppeteer } = await import("puppeteer");
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
    const page = await browser.newPage();
    await preparePage(page);
    const resp = await page.goto(probe.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const status = resp ? resp.status() : 0;
    const body = await page.content();
    const hit = blockMarkers.find((m) => body.includes(m));
    if (hit) {
      return { status: "fail", detail: `WAF block page ("${hit}"), HTTP ${status}` };
    }
    if (status >= 400) {
      return { status: "fail", detail: `HTTP ${status} at login URL` };
    }
    if (probe.loginSelector) {
      const found = await page.$(probe.loginSelector);
      if (!found) {
        return { status: "fail", detail: `login selector ${probe.loginSelector} not found` };
      }
      return { status: "pass", detail: `login form present (${probe.loginSelector})` };
    }
    return { status: "pass", detail: `reached login page (HTTP ${status}), no block markers` };
  } catch (err) {
    return { status: "fail", detail: err.message };
  } finally {
    await browser?.close();
  }
}

// L3: bogus credentials must classify as wrong-credentials promptly, proving
// the flow reaches and rejects at the login step rather than hanging into a
// navigation timeout (the "silently hangs" regression this guards).
async function checkWrongCreds(companyId, fields, timeoutMs) {
  const credentials = Object.fromEntries(fields.map((f) => [f, `probe-invalid-${f}`]));
  const scraper = createScraper({
    companyId,
    startDate: new Date(Date.now() - 7 * 24 * 3600 * 1000),
    showBrowser: false,
    timeout: timeoutMs,
    args: LAUNCH_ARGS,
    preparePage,
  });
  let result;
  try {
    result = await scraper.scrape(credentials);
  } catch (err) {
    return { status: "fail", detail: `scrape threw: ${err.message}` };
  }
  if (result.success) {
    return { status: "fail", detail: "bogus credentials unexpectedly succeeded" };
  }
  const mapped = mapLibraryErrorType(result.errorType);
  if (mapped === "wrong-credentials") {
    return { status: "pass", detail: `classified ${result.errorType} → wrong-credentials` };
  }
  return { status: "fail", detail: `got ${result.errorType} → ${mapped}, expected wrong-credentials` };
}

function readProbeCreds(companyId) {
  const raw = process.env[`PROBE_CREDS_${companyId}`];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`PROBE_CREDS_${companyId} is not valid JSON`);
  }
}

async function checkFullScrape(companyId, timeoutMs) {
  const creds = readProbeCreds(companyId);
  if (!creds) {
    return { status: "skip", detail: `no PROBE_CREDS_${companyId} in env` };
  }
  const scraper = createScraper({
    companyId,
    startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    showBrowser: false,
    timeout: timeoutMs,
    args: LAUNCH_ARGS,
    preparePage,
  });
  let result;
  try {
    result = await scraper.scrape(creds);
  } catch (err) {
    return { status: "fail", detail: `scrape threw: ${err.message}` };
  }
  if (!result.success) {
    return { status: "fail", detail: `errorType ${result.errorType}` };
  }
  const txns = (result.accounts || []).reduce((n, a) => n + (a.txns?.length || 0), 0);
  return { status: "pass", detail: `${result.accounts?.length || 0} account(s), ${txns} txn(s)` };
}

// Run L0..requestedLevel for one provider, stopping at the first hard failure
// (a higher level can't be trusted once a lower one is broken). A skip does
// not stop the chain.
async function probeProvider(companyId, manifestFields, probe, args) {
  const levels = {};
  const blockMarkers = [...DEFAULT_BLOCK_MARKERS, ...(probe.blockMarkers || [])];

  levels.L0 = toLevel(checkConfig(companyId, manifestFields));
  if (args.level >= 1 && levels.L0.status === "pass") {
    levels.L1 = await checkEgress(probe, args.timeoutMs);
  }
  if (args.level >= 2 && levels.L1?.status === "pass") {
    levels.L2 = await checkAntiBot(probe, blockMarkers, args.timeoutMs);
  }
  if (args.level >= 3 && levels.L2?.status === "pass") {
    levels.L3 = await checkWrongCreds(companyId, manifestFields, args.timeoutMs);
  }
  if (args.level >= 4 && levels.L3?.status === "pass") {
    levels.L4 = await checkFullScrape(companyId, args.timeoutMs);
  }
  return { provider: companyId, levels, reached: LEVELS[highestReached(levels)] || "none" };
}

function toLevel(configResult) {
  return {
    status: configResult.ok ? "pass" : "fail",
    detail: configResult.detail,
  };
}

export async function runDoctor(argv, { providersPath = "../providers.json", probesPath = "../probes.json" } = {}) {
  const args = parseArgs(argv);
  const manifest = loadJson(providersPath);
  const probes = loadJson(probesPath).providers;
  const selected = selectProviders(manifest, args.provider);

  const reports = [];
  for (const companyId of selected) {
    const probe = probes[companyId];
    if (!probe) {
      reports.push({
        provider: companyId,
        levels: { L0: { status: "fail", detail: "missing from probes.json" } },
        reached: "none",
      });
      continue;
    }
    reports.push(await probeProvider(companyId, manifest[companyId], probe, args));
  }
  return { args, reports, exitCode: computeExitCode(reports, args.level) };
}

function render({ args, reports }) {
  if (args.json) {
    return JSON.stringify({ requestedLevel: LEVELS[args.level], reports }, null, 2);
  }
  const lines = [formatMatrix(reports, args.level), ""];
  for (const rep of reports) {
    lines.push(`${rep.provider}: reached ${rep.reached}`);
    for (const lvl of LEVELS.slice(0, args.level + 1)) {
      const r = rep.levels[lvl];
      if (r) lines.push(`  ${lvl} ${cellIcon(r.status)} ${r.detail}`);
    }
  }
  return lines.join("\n");
}

function cellIcon(status) {
  return status === "pass" ? "✅" : status === "fail" ? "❌" : "–";
}

// Run when invoked directly (node src/doctor.js ...), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  runDoctor(process.argv.slice(2))
    .then((outcome) => {
      console.log(render(outcome));
      process.exit(outcome.exitCode);
    })
    .catch((err) => {
      console.error(`doctor: ${err.message}`);
      process.exit(2);
    });
}
