// Guards the #109 WAF-hardening fix at unit level: preparePage() must mask
// the automation fingerprints Cal's WAF keys on (HeadlessChrome/Linux UA,
// navigator.webdriver, missing accept-language) so the hardening can't
// silently regress.
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

import { preparePage } from "../src/app.js";

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
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  test("masks automation signals and presents a real desktop fingerprint", async () => {
    const page = await browser.newPage();
    await preparePage(page);
    await page.goto(origin);

    const fingerprint = await page.evaluate(() => ({
      webdriver: typeof navigator.webdriver,
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: [...navigator.languages],
      pluginCount: navigator.plugins.length,
    }));

    assert.equal(fingerprint.webdriver, "undefined");
    assert.ok(!fingerprint.userAgent.includes("HeadlessChrome"));
    assert.ok(!fingerprint.userAgent.includes("Linux"));
    assert.ok(fingerprint.userAgent.includes("Windows NT 10.0"));
    // UA must carry the real Chrome major version so it stays plausible
    // across Chromium upgrades.
    const realVersion = (await browser.version()).match(/Chrome\/([\d.]+)/)?.[1];
    assert.ok(realVersion, "could not read browser version");
    assert.ok(fingerprint.userAgent.includes(`Chrome/${realVersion}`));
    assert.equal(fingerprint.language, "he-IL");
    assert.deepEqual(fingerprint.languages, ["he-IL", "he", "en"]);
    assert.equal(fingerprint.pluginCount, 5);

    // Wire-level headers, as the WAF sees them.
    assert.equal(requestHeaders["accept-language"], "he-IL,he;q=0.9,en;q=0.8");
    assert.ok(!requestHeaders["user-agent"].includes("HeadlessChrome"));

    await page.close();
  });
});
