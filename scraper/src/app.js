import express from "express";
import { createScraper } from "israeli-bank-scrapers";

// Wire-format error vocabulary: the ONLY errorType values this service may
// return for a failed scrape (plus "unknown" from classifyError's null case).
// The backend and frontend key off these; anything outside the set risks
// leaking library/page detail to the caller.
export const SAFE_ERROR_TYPES = new Set([
  "wrong-credentials",
  "timeout",
  "account-blocked",
  "generic-error",
]);

// israeli-bank-scrapers reports a failed scrape as a *result* (not a throw)
// whose errorType is a ScraperErrorTypes enum value — "INVALID_PASSWORD",
// "TIMEOUT", "ACCOUNT_BLOCKED", "GENERIC", etc. Those must be translated to
// the wire vocabulary above; unmapped values (including future enum
// additions) collapse to "generic-error" so nothing unexpected passes
// through. scraper/test/app.test.js pins this table against the library's
// real enum, so a library bump that renames values fails the suite.
export const LIBRARY_ERROR_TYPE_MAP = {
  INVALID_PASSWORD: "wrong-credentials",
  // "Password expired, must be changed" — the user still has to go fix
  // their credentials, so it surfaces the same as a wrong password.
  CHANGE_PASSWORD: "wrong-credentials",
  TIMEOUT: "timeout",
  ACCOUNT_BLOCKED: "account-blocked",
};

export function mapLibraryErrorType(errorType) {
  return LIBRARY_ERROR_TYPE_MAP[errorType] ?? "generic-error";
}

// Banks (notably Cal) sit behind anti-bot WAFs that reject a vanilla headless
// browser outright ("Request Rejected"). israeli-bank-scrapers only supplies the
// scraping logic — it launches a plain headless Chromium and does no fingerprint
// hardening, so we apply moneyman's approach via the library's `preparePage` hook:
// present a real desktop User-Agent and mask the obvious automation signals
// before the page navigates. Using `preparePage` (an awaited ScraperOptions hook)
// rather than a browser-level event listener guarantees the patches are in place
// before the first navigation, avoiding a race.
export async function preparePage(page) {
  // Derive the real Chrome version so this survives Chromium upgrades, but
  // present a Windows UA — a Linux/HeadlessChrome UA is what Cal's WAF flags.
  const version =
    (String(await page.browser().version()).match(/Chrome\/([\d.]+)/) || [])[1] || "148.0.0.0";
  await page.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
  );
  await page.setExtraHTTPHeaders({ "accept-language": "he-IL,he;q=0.9,en;q=0.8" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "language", { get: () => "he-IL" });
    Object.defineProperty(navigator, "languages", { get: () => ["he-IL", "he", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });
}

// Classifies errors *thrown* by scraper.scrape() (launch failures, navigation
// crashes). The normal failure path is a returned result, handled by
// mapLibraryErrorType above.
export function classifyError(err) {
  if (!err) return "unknown";
  const msg = String(err.message || err).toLowerCase();
  if (msg.includes("credential") || msg.includes("password") || msg.includes("login")) {
    return "wrong-credentials";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("block") || msg.includes("captcha")) {
    return "account-blocked";
  }
  return "generic-error";
}

// scraperFactory and token are injectable for tests; production (src/index.js)
// uses the defaults.
export function createApp({
  scraperFactory = createScraper,
  token = process.env.SCRAPER_TOKEN || "",
} = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  function authMiddleware(req, res, next) {
    if (!token) return next();
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${token}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/scrape", authMiddleware, async (req, res) => {
    const { account, startDate } = req.body;

    if (!account || !account.companyId || !account.credentials) {
      return res.status(400).json({ errorType: "generic-error", transactions: [] });
    }

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ errorType: "generic-error", transactions: [] });
    }

    const companyId = account.companyId;
    const credentials = account.credentials;

    let scraper;
    try {
      scraper = scraperFactory({
        companyId,
        startDate: start,
        combineInstallments: false,
        showBrowser: false,
        navigationRetryCount: 3,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          // Drop the automation blink feature the WAF fingerprints.
          "--disable-blink-features=AutomationControlled",
          "--lang=he-IL",
        ],
        preparePage,
      });
    } catch (err) {
      console.error("[scrape %s] createScraper failed:", companyId, err);
      return res.status(400).json({ errorType: "generic-error", transactions: [] });
    }

    let result;
    try {
      result = await scraper.scrape(credentials);
    } catch (err) {
      const errorType = classifyError(err);
      console.error("[scrape %s] scrape threw (%s):", companyId, errorType, err);
      return res.json({ errorType, transactions: [], accountNumber: null });
    }

    if (!result.success) {
      const errorType = mapLibraryErrorType(result.errorType);
      console.error(
        "[scrape %s] scrape unsuccessful (errorType=%s, errorMessage=%s) → reported as %s",
        companyId,
        result.errorType,
        result.errorMessage,
        errorType,
      );
      return res.json({ errorType, transactions: [], accountNumber: null });
    }

    // Flatten transactions from all accounts in the result.
    const transactions = [];
    let accountNumber = null;
    for (const acct of result.accounts || []) {
      accountNumber = accountNumber || acct.accountNumber;
      for (const tx of acct.txns || []) {
        transactions.push({
          ...tx,
          accountNumber: acct.accountNumber,
        });
      }
    }

    res.json({ transactions, accountNumber, errorType: null });
  });

  return app;
}
