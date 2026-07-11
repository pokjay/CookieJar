// Pure-logic tests for the doctor probe (issue #110). No network / no browser
// — the live checks (egress/anti-bot/wrong-creds) run in the scraper-probes
// workflow, but the arg parsing, provider selection, config check, level
// roll-up, exit-code, and matrix formatting are deterministic and belong in
// the fast suite so the operator tool can't silently break.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  checkConfig,
  computeExitCode,
  DEFAULT_BLOCK_MARKERS,
  formatMatrix,
  highestReached,
  LEVELS,
  matchBlockMarker,
  parseArgs,
  selectProviders,
} from "../src/doctor.js";

describe("parseArgs", () => {
  test("defaults: all providers, level 2, human output", () => {
    const args = parseArgs([]);
    assert.equal(args.provider, null);
    assert.equal(args.level, 2);
    assert.equal(args.json, false);
    assert.ok(args.timeoutMs > 0);
  });

  test("parses flags", () => {
    const args = parseArgs(["--provider", "visaCal", "--level", "3", "--json", "--timeout", "5000"]);
    assert.equal(args.provider, "visaCal");
    assert.equal(args.level, 3);
    assert.equal(args.json, true);
    assert.equal(args.timeoutMs, 5000);
  });

  test("rejects out-of-range level and unknown flags", () => {
    assert.throws(() => parseArgs(["--level", "5"]), /level must be/);
    assert.throws(() => parseArgs(["--level", "-1"]), /level must be/);
    assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
    assert.throws(() => parseArgs(["--timeout", "0"]), /timeout must be/);
  });
});

describe("selectProviders", () => {
  const providers = { isracard: [], visaCal: [], max: [], amex: [] };

  test("null request → all", () => {
    assert.deepEqual(selectProviders(providers, null), ["isracard", "visaCal", "max", "amex"]);
  });

  test("a valid request → just that one", () => {
    assert.deepEqual(selectProviders(providers, "max"), ["max"]);
  });

  test("an unknown request throws with the known list", () => {
    assert.throws(() => selectProviders(providers, "hapoalim"), /Unknown provider 'hapoalim'/);
  });
});

describe("checkConfig", () => {
  const companyTypes = { visaCal: "visaCal", max: "max" };
  const scrapers = {
    visaCal: { loginFields: ["username", "password"] },
    max: { loginFields: ["username", "password"] },
  };

  test("matching fields pass regardless of order", () => {
    const r = checkConfig("visaCal", ["password", "username"], companyTypes, scrapers);
    assert.equal(r.ok, true);
  });

  test("unknown company fails", () => {
    const r = checkConfig("ghost", ["username"], companyTypes, scrapers);
    assert.equal(r.ok, false);
    assert.match(r.detail, /CompanyTypes/);
  });

  test("field mismatch fails with a diff", () => {
    const r = checkConfig("visaCal", ["username", "password", "otp"], companyTypes, scrapers);
    assert.equal(r.ok, false);
    assert.match(r.detail, /≠ library/);
  });

  test("real providers.json matches the real library", async () => {
    // Guards against manifest/library drift using the actual data, the same
    // invariant providers.test.js checks — but through the doctor's own code
    // path, since L0 depends on it.
    const { CompanyTypes, SCRAPERS } = await import("israeli-bank-scrapers");
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(
      readFileSync(new URL("../providers.json", import.meta.url), "utf8"),
    );
    for (const [companyId, fields] of Object.entries(manifest)) {
      const r = checkConfig(companyId, fields, CompanyTypes, SCRAPERS);
      assert.equal(r.ok, true, `${companyId}: ${r.detail}`);
    }
  });
});

describe("highestReached", () => {
  test("stops at the first non-pass", () => {
    assert.equal(
      highestReached({
        L0: { status: "pass" },
        L1: { status: "pass" },
        L2: { status: "fail" },
      }),
      1,
    );
  });

  test("-1 when L0 itself fails", () => {
    assert.equal(highestReached({ L0: { status: "fail" } }), -1);
  });

  test("a gap (skip) is not 'reached'", () => {
    assert.equal(
      highestReached({ L0: { status: "pass" }, L1: { status: "skip" }, L2: { status: "pass" } }),
      0,
    );
  });
});

describe("computeExitCode", () => {
  const report = (levels) => ({ provider: "x", levels });

  test("0 when every selected provider reaches the requested level", () => {
    const reports = [report({ L0: { status: "pass" }, L1: { status: "pass" } })];
    assert.equal(computeExitCode(reports, 1), 0);
  });

  test("1 when any provider fails at or below the requested level", () => {
    const reports = [report({ L0: { status: "pass" }, L1: { status: "fail" } })];
    assert.equal(computeExitCode(reports, 2), 1);
  });

  test("a failure ABOVE the requested level doesn't count", () => {
    const reports = [report({ L0: { status: "pass" }, L1: { status: "pass" }, L2: { status: "fail" } })];
    assert.equal(computeExitCode(reports, 1), 0);
  });

  test("a skip is not a failure", () => {
    const reports = [report({ L0: { status: "pass" }, L4: { status: "skip" } })];
    assert.equal(computeExitCode(reports, 4), 0);
  });
});

describe("formatMatrix", () => {
  test("renders a header plus one row per provider up to the requested level", () => {
    const reports = [
      { provider: "visaCal", levels: { L0: { status: "pass" }, L1: { status: "pass" }, L2: { status: "fail" } } },
      { provider: "max", levels: { L0: { status: "pass" }, L1: { status: "pass" }, L2: { status: "pass" } } },
    ];
    const out = formatMatrix(reports, 2);
    assert.match(out, /provider/);
    assert.match(out, /visaCal/);
    assert.match(out, /max/);
    // Only columns L0..L2 for a level-2 run.
    assert.ok(out.includes("L2"));
    assert.ok(!out.includes("L3"));
    assert.equal(LEVELS.length, 5);
  });
});

describe("matchBlockMarker", () => {
  test("catches the amex Cloudflare block page (issue #110 regression)", () => {
    // Trimmed from the real he.americanexpress.co.il block page the scraper hit.
    const cfBlock =
      "<h1>Sorry, you have been blocked</h1>" +
      "<p>Please enable cookies.</p>" +
      "Cloudflare Ray ID: a1924a8258e68cd1";
    assert.ok(matchBlockMarker(cfBlock, DEFAULT_BLOCK_MARKERS));
  });

  test("still catches the #109 Cal 'Request Rejected' block", () => {
    assert.equal(
      matchBlockMarker("<title>Request Rejected</title>", DEFAULT_BLOCK_MARKERS),
      "Request Rejected",
    );
  });

  test("is case-insensitive", () => {
    assert.ok(matchBlockMarker("YOU HAVE BEEN BLOCKED", DEFAULT_BLOCK_MARKERS));
  });

  test("a real login page is not flagged", () => {
    const loginPage = "<form id='login'><input name='password'></form>";
    assert.equal(matchBlockMarker(loginPage, DEFAULT_BLOCK_MARKERS), null);
  });
});
