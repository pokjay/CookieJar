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

// Banks sit behind anti-bot WAFs that reject a vanilla headless browser
// outright ("Request Rejected" from Cal, a Cloudflare block page from amex).
// israeli-bank-scrapers only supplies the scraping logic — it launches a plain
// headless Chromium and does no fingerprint hardening — so we mask the
// automation signals via the library's `preparePage` hook. Using `preparePage`
// (an awaited ScraperOptions hook) rather than a browser-level event listener
// guarantees the patches are in place before the first navigation.
//
// The one rule here: HIDE that we are automated, never LIE about what platform
// we are. `page.setUserAgent(ua)` rewrites only the UA *string* — it does not
// touch navigator.platform or the Sec-CH-UA-Platform request header, which keep
// reporting the real OS. So the Windows UA this used to send (added in #109 for
// Cal) made every request self-contradictory: a "Windows" UA from a box whose
// every other platform signal said Linux. amex's Cloudflare flags exactly that
// mismatch and served a block page to the login POST, while the landing-page GET
// sailed through — which is why it read as a working scraper until it didn't
// (#114). Cal never needed the Windows UA; masking `HeadlessChrome` is enough.
export async function preparePage(page, { companyId, diagnostics } = {}) {
  attachTrace(page);
  const guard = LOGIN_FORM_GUARDS[companyId];
  if (guard && diagnostics) watchLoginForm(page, guard, diagnostics);
  // Keep the real (Linux, current-version) identity and strip only the headless
  // tell, so UA string, navigator.platform and Sec-CH-UA-* all agree.
  const realUserAgent = await page.browser().userAgent();
  await page.setUserAgent(realUserAgent.replace("HeadlessChrome/", "Chrome/"));
  await page.setExtraHTTPHeaders({ "accept-language": "he-IL,he;q=0.9,en;q=0.8" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "language", { get: () => "he-IL" });
    Object.defineProperty(navigator, "languages", { get: () => ["he-IL", "he", "en"] });
  });
}

// When a scrape dies mid-flow, the library reports one line ("Navigation timeout
// of 30000 ms exceeded") that says nothing about WHERE the flow was. The trace
// logs the navigation + XHR timeline, which is what pinned #115: after "click on
// login submit button" there was no login request at all, only ad beacons.
//
// It is ON by default, because a bank site changing under the scraper is the
// normal failure mode and the evidence has to already be in the log — needing a
// redeploy to see it means the next failure is diagnosed a day late. It costs
// ~60 lines (~4.5 KB) per scrape once the trackers below are dropped.
//
//   SCRAPER_TRACE=full  also log third-party (analytics/ads) requests
//   SCRAPER_TRACE=off   log nothing
//
// Deliberately logs ONLY origin + path: query strings, headers and bodies are
// where the credentials and session tokens live, and this goes to container logs.
export function traceUrl(url) {
  try {
    const u = new URL(url);
    // Not u.origin: it is "null" for non-web schemes (chrome-extension:, data:),
    // which turns the log line into noise like "null/".
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

// The steps that reveal the flow: page/frame navigations and the API calls.
// Images, CSS, fonts and scripts are noise.
const TRACED_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);

// Bank login pages are packed with analytics and ad beacons — in a real scrape
// they were HALF of all traced requests and none of them ever explained a
// failure. Dropped by default so the timeline is readable.
//
// A denylist, not an allowlist, on purpose: an unknown host might be the very
// SSO/auth hop that a login depends on, and silently hiding that is the exact
// blindness this trace exists to fix. Worst case here is a few noisy lines.
const TRACKER_DOMAINS = [
  "google.com",
  "google-analytics.com",
  "googletagmanager.com",
  "googleadservices.com",
  "googleapis.com",
  "doubleclick.net",
  "adnxs.com",
  "clarity.ms",
  "hotjar.com",
  "facebook.com",
  "facebook.net",
  "taboola.com",
  "outbrain.com",
];

export function isTrackerUrl(url) {
  try {
    const host = new URL(url).hostname;
    return TRACKER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// "off" disables the trace; "full" keeps the third-party noise; anything else
// (including unset) is the default first-party timeline.
export function traceMode(value = process.env.SCRAPER_TRACE) {
  const mode = String(value || "").toLowerCase();
  if (mode === "off") return "off";
  if (mode === "full") return "full";
  return "first-party";
}

export function attachTrace(page, log = console.error, mode = traceMode()) {
  if (mode === "off") return;
  const skip = (url) => mode !== "full" && isTrackerUrl(url);

  page.on("framenavigated", (frame) => {
    if (skip(frame.url())) return;
    log("[trace] nav  %s", traceUrl(frame.url()));
  });
  page.on("request", (req) => {
    if (!TRACED_RESOURCE_TYPES.has(req.resourceType()) || skip(req.url())) return;
    log("[trace] ->   %s %s", req.method(), traceUrl(req.url()));
  });
  page.on("response", (res) => {
    if (!TRACED_RESOURCE_TYPES.has(res.request().resourceType()) || skip(res.url())) return;
    log("[trace] <- %d %s", res.status(), traceUrl(res.url()));
  });
}

// Some login forms validate a credential in the browser BEFORE they will submit
// it, and the library can't see that. Cal is the case that bit us (#115): its
// password field only accepts letters and digits — the validator's regex is
// [A-z0-9], which is why ^_[]\` slip through as well — and any other character
// leaves the Angular control `ng-invalid`. The library's clickButton() then calls
// el.click() on a form that (ngSubmit) refuses to run, so NO login request is ever
// sent, and the scrape dies 30 seconds later on a navigation that was never
// coming. The user saw "generic-error" and had no way to know their password was
// the problem.
//
// So watch the field the site is judging. If the site's own form says the value
// is unusable, say that, instead of letting it surface as a mystery timeout.
export const LOGIN_FORM_GUARDS = {
  visaCal: {
    frameUrlIncludes: "connect.cal-online",
    field: "password",
    selector: '[formcontrolname="password"]',
    hint: "Cal's login form accepts only letters and digits in the password; it marked the password invalid and never submitted the form",
  },
};

// A non-empty value that the page's own validator rejects. Empty is just "not
// typed yet" (the control is `required`), not a rejection.
export function isFieldRejected(state) {
  return Boolean(state) && state.length > 0 && state.invalid;
}

// Polls the login field's validity. Reads only the value's LENGTH and Angular's
// validity class — never the value, which is a live credential.
export function watchLoginForm(page, guard, diagnostics, log = console.error) {
  let previous = null;
  const timer = setInterval(async () => {
    const frame = page.frames().find((f) => f.url().includes(guard.frameUrlIncludes));
    if (!frame) return;
    try {
      const state = await frame.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        return { length: el.value.length, invalid: el.className.includes("ng-invalid") };
      }, guard.selector);
      if (!state) return;
      // Latch the LAST state, not the first: a value is transiently invalid
      // while it is still being typed.
      diagnostics.rejectedField = isFieldRejected(state) ? guard : null;
      // Log transitions only — a couple of lines per scrape, and they show
      // whether the site ever accepted the credential we typed.
      const line = `${guard.field} length=${state.length} accepted=${!state.invalid}`;
      if (line !== previous && traceMode() !== "off") {
        log("[form] %s", line);
        previous = line;
      }
    } catch {
      // The frame navigated out from under the evaluate — nothing to report.
    }
  }, 500);
  timer.unref?.();
  page.once("close", () => clearInterval(timer));
  return timer;
}

// The library's errorType, unless the page told us something more specific first.
// A field the site itself refused is a credential problem, not a generic one —
// and "wrong-credentials" is what actually points the user at the fix.
export function resolveErrorType(libraryErrorType, diagnostics) {
  if (diagnostics?.rejectedField) return "wrong-credentials";
  return mapLibraryErrorType(libraryErrorType);
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

// One place that decides what a failed scrape looks like in the logs. When the
// page told us why (a field its own form rejected), lead with that — the library
// error underneath it is just the symptom ("Navigation timeout of 30000 ms
// exceeded" for a login that was never submitted).
function logFailure(companyId, errorType, diagnostics, err, result) {
  const rejected = diagnostics?.rejectedField;
  if (rejected) {
    console.error(
      "[scrape %s] the site's own login form rejected the %s — %s. No login request was ever sent. → reported as %s",
      companyId,
      rejected.field,
      rejected.hint,
      errorType,
    );
    return;
  }
  if (err) {
    console.error("[scrape %s] scrape threw (%s):", companyId, errorType, err);
    return;
  }
  console.error(
    "[scrape %s] scrape unsuccessful (errorType=%s, errorMessage=%s) → reported as %s",
    companyId,
    result.errorType,
    result.errorMessage,
    errorType,
  );
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

    // Filled in by the login-form guard (see LOGIN_FORM_GUARDS) while the scrape
    // runs, so a failure can be explained rather than just reported.
    const diagnostics = {};

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
        preparePage: (page) => preparePage(page, { companyId, diagnostics }),
      });
    } catch (err) {
      console.error("[scrape %s] createScraper failed:", companyId, err);
      return res.status(400).json({ errorType: "generic-error", transactions: [] });
    }

    let result;
    try {
      result = await scraper.scrape(credentials);
    } catch (err) {
      const errorType = diagnostics.rejectedField ? "wrong-credentials" : classifyError(err);
      logFailure(companyId, errorType, diagnostics, err);
      return res.json({ errorType, transactions: [], accountNumber: null });
    }

    if (!result.success) {
      const errorType = resolveErrorType(result.errorType, diagnostics);
      logFailure(companyId, errorType, diagnostics, null, result);
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
