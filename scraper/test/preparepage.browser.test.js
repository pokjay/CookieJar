// Guards the WAF-hardening at unit level, on both sides of it:
//
//   #109 — the automation tells must stay masked (no HeadlessChrome in the UA,
//          no navigator.webdriver, an accept-language header on the wire).
//   #114 — the mask must not CONTRADICT itself. preparePage used to send a
//          Windows UA string from a Linux box; setUserAgent doesn't touch
//          navigator.platform (and silences the Sec-CH-UA* request headers
//          entirely rather than aligning them), so the JS-visible platform
//          still said Linux and amex's Cloudflare blocked the login POST on
//          the mismatch. Every platform signal that IS emitted must name the
//          same OS.
//
// Needs a real Chromium. Resolution order: $PUPPETEER_EXECUTABLE_PATH, then
// puppeteer's own bundled browser if present. Without one the test skips —
// except when REQUIRE_BROWSER_TESTS is set (CI does), where a missing browser
// must fail loudly instead of producing a false green.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";

// puppeteer is israeli-bank-scrapers' own dependency — the exact one the
// production scrape path drives — so import it rather than pinning a second
// copy in devDependencies that could skew versions.
import puppeteer from "puppeteer";

import { LOGIN_FORM_GUARDS, preparePage, resolveErrorType, watchLoginForm } from "../src/app.js";

function resolveExecutable() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // No bundled browser (PUPPETEER_SKIP_DOWNLOAD installs) — fall through.
  }
  return null;
}

const executablePath = resolveExecutable();
if (!executablePath && process.env.REQUIRE_BROWSER_TESTS) {
  throw new Error(
    "REQUIRE_BROWSER_TESTS is set but no Chromium was found — " +
      "set PUPPETEER_EXECUTABLE_PATH to a browser binary.",
  );
}

describe("preparePage hardening", { skip: executablePath ? false : "no Chromium available" }, () => {
  let browser;
  let server;
  let origin;
  // Captured from the real HTTP request the hardened page makes, so header
  // patches (accept-language, UA) are verified on the wire, not just in JS.
  let requestHeaders;
  // Sec-CH-UA-Platform as sent by an UNprepared page, captured in before().
  // Proves the probe server/browser do exchange client hints, so the hardened
  // page's missing hint below is attributable to preparePage, not a broken
  // capture.
  let baselinePlatformHint;

  before(async () => {
    server = http.createServer((req, res) => {
      requestHeaders = req.headers;
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>probe</title>ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;

    // Deliberately WITHOUT --disable-blink-features=AutomationControlled
    // (which production also passes): navigator.webdriver stays `true` at
    // launch, so a passing test proves preparePage's own masking works even
    // if the launch args ever get lost.
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });

    const baselinePage = await browser.newPage();
    await baselinePage.goto(origin);
    baselinePlatformHint = requestHeaders["sec-ch-ua-platform"];
    await baselinePage.close();
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  test("masks automation signals (#109)", async () => {
    const page = await browser.newPage();
    await preparePage(page);
    await page.goto(origin);

    const fingerprint = await page.evaluate(() => ({
      webdriver: typeof navigator.webdriver,
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: [...navigator.languages],
    }));

    assert.equal(fingerprint.webdriver, "undefined");
    assert.ok(!fingerprint.userAgent.includes("HeadlessChrome"));
    // UA must carry the running browser's real Chrome major version, so it
    // can't drift stale across Chromium upgrades. Only the major is checked:
    // Chrome's UA reduction pins the rest to 0.0.0 (Chrome/150.0.0.0) even
    // though browser.version() reports the full 150.0.7871.100.
    const realMajor = (await browser.version()).match(/Chrome\/(\d+)\./)?.[1];
    assert.ok(realMajor, "could not read browser version");
    assert.ok(
      fingerprint.userAgent.includes(`Chrome/${realMajor}.`),
      `UA ${fingerprint.userAgent} does not carry Chrome major ${realMajor}`,
    );
    assert.equal(fingerprint.language, "he-IL");
    assert.deepEqual(fingerprint.languages, ["he-IL", "he", "en"]);

    // Wire-level headers, as the WAF sees them.
    assert.equal(requestHeaders["accept-language"], "he-IL,he;q=0.9,en;q=0.8");
    assert.ok(!requestHeaders["user-agent"].includes("HeadlessChrome"));

    await page.close();
  });

  test("never claims a platform it isn't running on (#114)", async () => {
    const page = await browser.newPage();
    await preparePage(page);
    await page.goto(origin);

    const { userAgent, platform } = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
    }));

    // The three places a site can ask "what OS is this?". A WAF compares them,
    // so they must not disagree — that disagreement is what got amex blocked.
    const uaOs = osFromUserAgent(userAgent);
    assert.notEqual(uaOs, "unknown", `could not read an OS from UA: ${userAgent}`);
    assert.equal(uaOs, osFromPlatform(platform), "UA string contradicts navigator.platform");

    // page.setUserAgent() with a bare string (no userAgentMetadata) makes
    // Chromium stop sending ALL Sec-CH-UA* client hints, so today the platform
    // hint cannot contradict the UA because it is SILENCED, not consistent.
    // Pin both halves of that: if a hint ever appears again (a future
    // puppeteer forwarding metadata), it must agree with the UA; if it is
    // absent, the baseline capture must show the header does flow without
    // preparePage — otherwise the absence is a broken probe, not the
    // documented setUserAgent effect, and this guard would be vacuous.
    const hint = requestHeaders["sec-ch-ua-platform"];
    if (hint === undefined) {
      assert.ok(
        baselinePlatformHint,
        "sec-ch-ua-platform missing even without preparePage — hint capture is broken",
      );
    } else {
      assert.equal(
        osFromPlatformHint(hint),
        uaOs,
        `UA string contradicts Sec-CH-UA-Platform (${hint})`,
      );
    }

    await page.close();
  });
});

// #115: the guard is what turns "Navigation timeout of 30000 ms exceeded" into
// "the site rejected your password". Drive it against a real browser and a form
// that validates like Cal's.
describe("login-form guard", { skip: executablePath ? false : "no Chromium available" }, () => {
  let browser;
  let server;
  let origin;

  before(async () => {
    server = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><title>login</title>
        <input formcontrolname="password" type="password" class="ng-invalid">
        <script>
          const el = document.querySelector('[formcontrolname="password"]');
          el.addEventListener('input', () => {
            const ok = el.value.length > 0 && /^[A-Za-z0-9]+$/.test(el.value);
            el.className = ok ? 'ng-valid' : 'ng-invalid';
          });
        </script>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  const guard = { ...LOGIN_FORM_GUARDS.visaCal, frameUrlIncludes: "127.0.0.1" };
  // The watcher polls every 500ms.
  const settle = () => new Promise((r) => setTimeout(r, 900));

  test("flags a password the form itself refuses", async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    const diagnostics = {};
    watchLoginForm(page, guard, diagnostics, () => {});

    // A password with a character Cal's validator rejects — exactly the shape of
    // the one that broke visaCal in production.
    await page.type('[formcontrolname="password"]', "my-p@ssword-2026");
    await settle();
    assert.ok(diagnostics.rejectedField, "expected the rejected password to be flagged");
    assert.equal(diagnostics.rejectedField.field, "password");
    assert.equal(resolveErrorType("GENERIC", diagnostics), "wrong-credentials");

    await page.close();
  });

  test("stays quiet for a password the form accepts", async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    const diagnostics = {};
    watchLoginForm(page, guard, diagnostics, () => {});

    await page.type('[formcontrolname="password"]', "alphanumeric2026");
    await settle();
    assert.equal(diagnostics.rejectedField, null);
    // The watcher saw the field — logFailure relies on this to tell "the
    // password was fine" apart from "the guard's selectors went stale".
    assert.equal(diagnostics.fieldObserved, true);
    // A genuine failure must still report as itself.
    assert.equal(resolveErrorType("GENERIC", diagnostics), "generic-error");

    await page.close();
  });

  test("a rejection survives the form being wiped", async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    const diagnostics = {};
    watchLoginForm(page, guard, diagnostics, () => {});

    await page.type('[formcontrolname="password"]', "my-p@ssword-2026");
    await settle();
    assert.ok(diagnostics.rejectedField, "expected the rejected password to be flagged");

    // A navigation retry reloading the login form empties the field. Empty is
    // "not typed yet", not "the site changed its mind" — the rejection stands.
    await page.$eval('[formcontrolname="password"]', (el) => {
      el.value = "";
      el.dispatchEvent(new Event("input"));
    });
    await settle();
    assert.ok(diagnostics.rejectedField, "an emptied field must not erase a seen rejection");

    await page.close();
  });

  test("a rejection clears once the site accepts a later value", async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    const diagnostics = {};
    watchLoginForm(page, guard, diagnostics, () => {});

    await page.type('[formcontrolname="password"]', "my-p@ssword-2026");
    await settle();
    assert.ok(diagnostics.rejectedField, "expected the rejected password to be flagged");

    // The user (or a retry) replaces it with a value the form accepts: only the
    // site's own acceptance clears the latch.
    await page.$eval('[formcontrolname="password"]', (el) => {
      el.value = "";
      el.dispatchEvent(new Event("input"));
    });
    await page.type('[formcontrolname="password"]', "alphanumeric2026");
    await settle();
    assert.equal(diagnostics.rejectedField, null);

    await page.close();
  });

  test("does not flag a half-typed password as rejected", async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    const diagnostics = {};
    watchLoginForm(page, guard, diagnostics, () => {});

    // Mid-typing, a valid password is briefly invalid (empty). The guard latches
    // the LAST state, so it must not report a rejection once typing completes.
    await page.type('[formcontrolname="password"]', "abc", { delay: 200 });
    await page.type('[formcontrolname="password"]', "def", { delay: 200 });
    await settle();
    assert.equal(diagnostics.rejectedField, null);

    await page.close();
  });
});

function osFromUserAgent(ua) {
  if (ua.includes("Windows NT")) return "Windows";
  if (ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Linux") || ua.includes("X11")) return "Linux";
  return "unknown";
}

function osFromPlatform(platform) {
  if (platform.startsWith("Win")) return "Windows";
  if (platform.startsWith("Mac")) return "macOS";
  if (platform.includes("Linux")) return "Linux";
  return "unknown";
}

// Sent quoted, e.g. `"Linux"`.
function osFromPlatformHint(hint) {
  const bare = hint.replace(/"/g, "").trim();
  if (bare === "Windows") return "Windows";
  if (bare === "macOS") return "macOS";
  if (bare === "Linux" || bare === "Android" || bare === "Chrome OS") return "Linux";
  return "unknown";
}
