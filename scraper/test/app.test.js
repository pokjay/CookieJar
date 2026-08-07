import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

// ScraperErrorTypes isn't re-exported from the package root, hence the deep
// import. If a library bump breaks this path, that's a signal the error
// vocabulary may have moved too — update LIBRARY_ERROR_TYPE_MAP alongside it.
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { CompanyTypes } from "israeli-bank-scrapers";

import {
  attachTrace,
  classifyError,
  createApp,
  describeFailure,
  ERROR_TYPE_FALLBACKS,
  FUTURE_MONTHS_TO_SCRAPE,
  isFieldRejected,
  isTrackerUrl,
  LIBRARY_ERROR_TYPE_MAP,
  logFailure,
  LOGIN_FORM_GUARDS,
  mapLibraryErrorType,
  preparePage,
  resolveErrorType,
  resolveThrownErrorType,
  SAFE_ERROR_TYPES,
  traceMode,
  traceUrl,
  withTimestamp,
} from "../src/app.js";

// ── helpers ──────────────────────────────────────────────────────────────────

// A scraperFactory stub that records the options it was built with and
// resolves scrape() with a canned result (or rejects with a canned error).
function stubFactory({ result, scrapeError, factoryError } = {}) {
  const calls = [];
  const factory = (options) => {
    calls.push(options);
    if (factoryError) throw factoryError;
    return {
      scrape: async () => {
        if (scrapeError) throw scrapeError;
        return result;
      },
    };
  };
  factory.calls = calls;
  return factory;
}

// Boot the app on an ephemeral port, run fn(base), always close the server.
async function withServer(appOptions, fn) {
  const server = createApp(appOptions).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.close();
  }
}

async function postScrape(base, body, headers = {}) {
  const res = await fetch(`${base}/scrape`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const VALID_BODY = {
  account: {
    companyId: "visaCal",
    credentials: { username: "user-1", password: "hunter2-secret" },
  },
  startDate: "2026-06-01",
};

const SUCCESS_RESULT = {
  success: true,
  accounts: [{ accountNumber: "1111", txns: [{ chargedAmount: -5 }] }],
};

// ── classifyError (thrown-error path) ────────────────────────────────────────

describe("classifyError", () => {
  const cases = [
    ["invalid credentials supplied", "wrong-credentials"],
    ["bad Password for user", "wrong-credentials"],
    ["could not find login form", "wrong-credentials"],
    ["Navigation timeout of 30000 ms exceeded", "timeout"],
    ["request timed out", "timeout"],
    ["account is blocked", "account-blocked"],
    ["please solve the captcha", "account-blocked"],
    ["ERR_CONNECTION_RESET", "generic-error"],
  ];
  for (const [message, expected] of cases) {
    test(`"${message}" → ${expected}`, () => {
      assert.equal(classifyError(new Error(message)), expected);
    });
  }

  test("null / undefined → unknown", () => {
    assert.equal(classifyError(null), "unknown");
    assert.equal(classifyError(undefined), "unknown");
  });

  test("non-Error values classify by their string form", () => {
    assert.equal(classifyError("login rejected"), "wrong-credentials");
    assert.equal(classifyError({ weird: true }), "generic-error");
  });
});

// ── library errorType → wire vocabulary mapping ──────────────────────────────

describe("mapLibraryErrorType", () => {
  test("credential-class enum values → wrong-credentials", () => {
    assert.equal(mapLibraryErrorType("INVALID_PASSWORD"), "wrong-credentials");
    assert.equal(mapLibraryErrorType("CHANGE_PASSWORD"), "wrong-credentials");
  });

  test("TIMEOUT → timeout, ACCOUNT_BLOCKED → account-blocked", () => {
    assert.equal(mapLibraryErrorType("TIMEOUT"), "timeout");
    assert.equal(mapLibraryErrorType("ACCOUNT_BLOCKED"), "account-blocked");
  });

  test("everything else collapses to generic-error", () => {
    assert.equal(mapLibraryErrorType("GENERIC"), "generic-error");
    assert.equal(mapLibraryErrorType("GENERAL_ERROR"), "generic-error");
    assert.equal(mapLibraryErrorType("TWO_FACTOR_RETRIEVER_MISSING"), "generic-error");
    assert.equal(mapLibraryErrorType("SOME_FUTURE_VALUE"), "generic-error");
    assert.equal(mapLibraryErrorType(undefined), "generic-error");
  });

  // Drift guards: a library bump that renames/removes enum values must fail
  // here, not silently degrade every failure to generic-error again (#110).
  test("every LIBRARY_ERROR_TYPE_MAP key is a real ScraperErrorTypes value", () => {
    const enumValues = new Set(Object.values(ScraperErrorTypes));
    for (const key of Object.keys(LIBRARY_ERROR_TYPE_MAP)) {
      assert.ok(enumValues.has(key), `${key} is no longer in ScraperErrorTypes`);
    }
  });

  test("the library's credential/timeout/blocked values are all mapped (not generic)", () => {
    assert.equal(mapLibraryErrorType(ScraperErrorTypes.InvalidPassword), "wrong-credentials");
    assert.equal(mapLibraryErrorType(ScraperErrorTypes.ChangePassword), "wrong-credentials");
    assert.equal(mapLibraryErrorType(ScraperErrorTypes.Timeout), "timeout");
    assert.equal(mapLibraryErrorType(ScraperErrorTypes.AccountBlocked), "account-blocked");
  });

  test("every possible mapping output is wire-safe", () => {
    for (const value of Object.values(ScraperErrorTypes)) {
      assert.ok(SAFE_ERROR_TYPES.has(mapLibraryErrorType(value)));
    }
    for (const mapped of Object.values(LIBRARY_ERROR_TYPE_MAP)) {
      assert.ok(SAFE_ERROR_TYPES.has(mapped));
    }
  });
});

// ── /scrape request validation ───────────────────────────────────────────────

describe("POST /scrape validation", () => {
  const invalidBodies = [
    ["empty body", {}],
    ["missing companyId", { ...VALID_BODY, account: { credentials: { a: "b" } } }],
    ["missing credentials", { ...VALID_BODY, account: { companyId: "visaCal" } }],
    ["missing startDate", { account: VALID_BODY.account }],
    ["unparseable startDate", { ...VALID_BODY, startDate: "not-a-date" }],
  ];

  for (const [name, body] of invalidBodies) {
    test(`${name} → 400 generic-error without building a scraper`, async () => {
      const factory = stubFactory({ result: SUCCESS_RESULT });
      await withServer({ scraperFactory: factory }, async (base) => {
        const { status, body: resBody } = await postScrape(base, body);
        assert.equal(status, 400);
        assert.equal(resBody.errorType, "generic-error");
        assert.deepEqual(resBody.transactions, []);
        assert.equal(factory.calls.length, 0);
      });
    });
  }

  test("scraperFactory throwing → 400 generic-error", async () => {
    const factory = stubFactory({ factoryError: new Error("unknown company") });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { status, body } = await postScrape(base, VALID_BODY);
      assert.equal(status, 400);
      assert.equal(body.errorType, "generic-error");
    });
  });

  test("factory receives companyId, parsed startDate and the preparePage hook", async () => {
    const factory = stubFactory({ result: SUCCESS_RESULT });
    await withServer({ scraperFactory: factory }, async (base) => {
      await postScrape(base, VALID_BODY);
      assert.equal(factory.calls.length, 1);
      const options = factory.calls[0];
      assert.equal(options.companyId, "visaCal");
      assert.ok(options.startDate instanceof Date);
      assert.equal(options.startDate.toISOString().slice(0, 10), "2026-06-01");
      // preparePage is now bound per-scrape (it carries the companyId and the
      // diagnostics object the login-form guard writes into), so it's a closure
      // over the shared hook rather than the hook itself.
      assert.equal(typeof options.preparePage, "function");
      assert.equal(options.showBrowser, false);
      // The bank-category enrichment is opt-in per request and absent here, so
      // it stays off — it is what trips isracard/amex's 429 rate limit, and
      // CookieJar categorises from its own description_to_category table
      // anyway. #132's other half (upcoming months, for delayed credit-card
      // charges) is unconditional.
      assert.equal(options.additionalTransactionInformation, false);
      assert.equal(options.futureMonthsToScrape, FUTURE_MONTHS_TO_SCRAPE);
    });
  });
});

// #115: Cal's login form validates the password in the browser and refuses to
// submit an invalid one, so the library never sends a login request and dies on
// a 30s navigation timeout — reported as a bare "generic-error" that told the
// user nothing. When the page has told us the field was rejected, that wins.
describe("login-form rejection is reported as a credential problem", () => {
  test("a rejected field is only a rejection once something has been typed", () => {
    // Empty is "not filled in yet" — the control is `required`, so it is
    // invalid from the moment the form renders. That is not a rejection.
    assert.equal(isFieldRejected({ length: 0, invalid: true }), false);
    assert.equal(isFieldRejected({ length: 12, invalid: false }), false);
    assert.equal(isFieldRejected({ length: 20, invalid: true }), true);
    assert.equal(isFieldRejected(null), false);
  });

  test("a rejected field outranks the library's error type", () => {
    const rejected = { rejectedField: LOGIN_FORM_GUARDS.visaCal };
    // What Cal actually produces: GENERIC -> would be a useless "generic-error".
    assert.equal(resolveErrorType("GENERIC", {}), "generic-error");
    assert.equal(resolveErrorType("GENERIC", rejected), "wrong-credentials");
    assert.equal(resolveErrorType("TIMEOUT", rejected), "wrong-credentials");
  });

  test("the thrown-error path applies the same precedence", () => {
    const rejected = { rejectedField: LOGIN_FORM_GUARDS.visaCal };
    const timeout = new Error("Navigation timeout of 30000 ms exceeded");
    assert.equal(resolveThrownErrorType(timeout, rejected), "wrong-credentials");
    // Without a rejection, thrown errors keep their own classification.
    assert.equal(resolveThrownErrorType(timeout, {}), "timeout");
    assert.equal(resolveThrownErrorType(new Error("boom"), undefined), "generic-error");
  });

  test("a rejection never hides the underlying error or result", () => {
    const lines = [];
    const log = (...args) => lines.push(args);
    const diagnostics = { rejectedField: LOGIN_FORM_GUARDS.visaCal, fieldObserved: true };

    // Thrown path: the crash evidence must survive the rejection message. It is
    // logged as its scrubbed stack (see scrubError) rather than the Error object
    // itself, so assert on the text — the message and the stack must both be there.
    const crash = new Error("browser disconnected");
    logFailure("visaCal", "wrong-credentials", diagnostics, crash, undefined, log);
    const thrownText = JSON.stringify(lines);
    assert.ok(thrownText.includes("browser disconnected"), "expected the thrown error to be logged");
    assert.ok(thrownText.includes("app.test.js"), "expected the stack to survive too");

    // Returned-result path: the library's own errorType/errorMessage survive too.
    lines.length = 0;
    const result = { errorType: "GENERIC", errorMessage: "Navigation timeout" };
    logFailure("visaCal", "wrong-credentials", diagnostics, null, result, log);
    assert.ok(
      lines.some((args) => args.includes("GENERIC") && args.includes("Navigation timeout")),
      "expected the library result to be logged",
    );
  });

  test("a guard that never observed its field says so on failure", () => {
    const lines = [];
    const log = (...args) => lines.push(args.join(" "));

    // Guard configured, field never seen: the stale-guard warning must fire.
    logFailure("visaCal", "generic-error", {}, null, { errorType: "GENERIC" }, log);
    assert.ok(
      lines.some((line) => line.includes("never observed its field")),
      "expected a stale-guard warning",
    );

    // Field observed, or no guard for the company: no warning.
    lines.length = 0;
    logFailure("visaCal", "generic-error", { fieldObserved: true }, null, { errorType: "GENERIC" }, log);
    logFailure("hapoalim", "generic-error", {}, null, { errorType: "GENERIC" }, log);
    assert.ok(!lines.some((line) => line.includes("never observed its field")));
  });

  test("without a rejection, the library's mapping is untouched", () => {
    assert.equal(resolveErrorType("INVALID_PASSWORD", {}), "wrong-credentials");
    assert.equal(resolveErrorType("TIMEOUT", {}), "timeout");
    assert.equal(resolveErrorType("GENERIC", undefined), "generic-error");
  });

  test("the trace keeps the bank and drops the ad-tech", () => {
    // Half of every scrape's traced requests were beacons like these, and none of
    // them ever explained a failure.
    assert.equal(isTrackerUrl("https://www.google-analytics.com/g/collect"), true);
    assert.equal(isTrackerUrl("https://ad.doubleclick.net/ccm/s/collect"), true);
    assert.equal(isTrackerUrl("https://q.clarity.ms/collect"), true);
    assert.equal(isTrackerUrl("https://www.googletagmanager.com/gtm.js"), true);

    // The requests that actually matter — the ones whose absence WAS the bug.
    assert.equal(
      isTrackerUrl("https://connect.cal-online.co.il/col-rest/calconnect/authentication/login"),
      false,
    );
    assert.equal(isTrackerUrl("https://he.americanexpress.co.il/services/ProxyRequestHandler.ashx"), false);
    assert.equal(isTrackerUrl("not a url"), false);

    // Multi-purpose platform domains are NOT trackers: a login can genuinely
    // depend on them (reCAPTCHA, SSO, OAuth), and dropping that hop would
    // reproduce the exact "no request after the submit click" blindness of #115.
    assert.equal(isTrackerUrl("https://www.google.com/recaptcha/api2/reload"), false);
    assert.equal(isTrackerUrl("https://accounts.google.com/o/oauth2/v2/auth"), false);
    assert.equal(isTrackerUrl("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"), false);
    assert.equal(isTrackerUrl("https://www.facebook.com/v19.0/dialog/oauth"), false);
  });

  test("the trace is on unless explicitly turned off", () => {
    assert.equal(traceMode(undefined), "first-party");
    assert.equal(traceMode(""), "first-party");
    assert.equal(traceMode("1"), "first-party");
    assert.equal(traceMode("full"), "full");
    assert.equal(traceMode("off"), "off");
    assert.equal(traceMode("OFF"), "off");
  });

  test("the trace never logs query strings, where the secrets are", () => {
    // amex puts the request name in the query; Cal puts tokens there.
    assert.equal(
      traceUrl("https://he.americanexpress.co.il/services/ProxyRequestHandler.ashx?reqName=performLogonI&t=abc"),
      "https://he.americanexpress.co.il/services/ProxyRequestHandler.ashx",
    );
    assert.equal(traceUrl("chrome-extension://invalid/"), "chrome-extension://invalid/");
    assert.equal(traceUrl("nullblank"), "(unparseable url)");
  });

  test("the visaCal guard watches the field Cal actually validates", () => {
    const guard = LOGIN_FORM_GUARDS.visaCal;
    assert.equal(guard.field, "password");
    assert.equal(guard.selector, '[formcontrolname="password"]');
    assert.ok(guard.frameUrlIncludes.includes("connect.cal-online"));
    assert.ok(guard.hint.length > 0);
  });

  test("every guard is keyed by a company the library recognizes", () => {
    // Same drift guard as providers.test.js: the runtime lookup is
    // LOGIN_FORM_GUARDS[companyId], so a key the library renames away would
    // silently detach the guard and regress Cal to generic-error.
    for (const key of Object.keys(LOGIN_FORM_GUARDS)) {
      assert.ok(
        Object.values(CompanyTypes).includes(key),
        `${key} missing from CompanyTypes — removed or renamed by the library?`,
      );
    }
  });
});

// ── /scrape success path ─────────────────────────────────────────────────────

describe("POST /scrape success path", () => {
  test("flattens txns across accounts, each tagged with its own accountNumber", async () => {
    const factory = stubFactory({
      result: {
        success: true,
        accounts: [
          { accountNumber: "1111", txns: [{ chargedAmount: -1 }, { chargedAmount: -2 }] },
          { accountNumber: "2222", txns: [{ chargedAmount: -3 }] },
        ],
      },
    });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { status, body } = await postScrape(base, VALID_BODY);
      assert.equal(status, 200);
      assert.equal(body.errorType, null);
      // Top-level accountNumber is the first sub-account's (a fallback only —
      // the backend prefers each tx's own accountNumber).
      assert.equal(body.accountNumber, "1111");
      assert.deepEqual(
        body.transactions.map((t) => t.accountNumber),
        ["1111", "1111", "2222"],
      );
    });
  });

  test("tolerates missing accounts / txns arrays", async () => {
    const factory = stubFactory({ result: { success: true } });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { status, body } = await postScrape(base, VALID_BODY);
      assert.equal(status, 200);
      assert.deepEqual(body.transactions, []);
      assert.equal(body.accountNumber, null);
    });

    const noTxns = stubFactory({ result: { success: true, accounts: [{ accountNumber: "9" }] } });
    await withServer({ scraperFactory: noTxns }, async (base) => {
      const { body } = await postScrape(base, VALID_BODY);
      assert.deepEqual(body.transactions, []);
      assert.equal(body.accountNumber, "9");
    });
  });
});

// ── /scrape failure paths: mapping + leak safety ─────────────────────────────

describe("POST /scrape failure paths", () => {
  test("library INVALID_PASSWORD result → wrong-credentials on the wire", async () => {
    const factory = stubFactory({
      result: { success: false, errorType: "INVALID_PASSWORD", errorMessage: "bad password" },
    });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { status, body } = await postScrape(base, VALID_BODY);
      assert.equal(status, 200);
      assert.equal(body.errorType, "wrong-credentials");
    });
  });

  test("unsafe/unknown errorType is scrubbed to generic-error", async () => {
    const factory = stubFactory({
      result: { success: false, errorType: "WEIRD_INTERNAL_STATE", errorMessage: "boom" },
    });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { body } = await postScrape(base, VALID_BODY);
      assert.equal(body.errorType, "generic-error");
    });
  });

  test("error responses never leak errorMessage, page text or credentials", async () => {
    const leaky = "Request Rejected: session for user-1 password=hunter2-secret";
    const factory = stubFactory({
      result: { success: false, errorType: "GENERIC", errorMessage: leaky },
    });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { body } = await postScrape(base, VALID_BODY);
      assert.deepEqual(Object.keys(body).sort(), [
        "accountNumber",
        "errorMessage",
        "errorType",
        "transactions",
      ]);
      // errorMessage is OUR sentence, chosen by describeFailure — never the
      // provider's text, which is what carries the credentials and tokens.
      assert.equal(body.errorMessage, ERROR_TYPE_FALLBACKS["generic-error"]);
      const raw = JSON.stringify(body);
      assert.ok(!raw.includes("hunter2-secret"));
      assert.ok(!raw.includes("user-1"));
      assert.ok(!raw.includes("Request Rejected"));
    });
  });

  test("the failure log keeps the URL's path but never its query string", () => {
    // CLAUDE.md: query strings from bank sites are where tokens and record ids
    // live, and this line goes to the container log.
    const lines = [];
    const log = (...args) => lines.push(args);
    const raw =
      "Automation detected and blocked. Status: 429, URL: " +
      "https://digital.isracard.co.il/services/ProxyRequestHandler.ashx?reqName=PirteyIska_204" +
      "&CardIndex=0&shovarRatz=651687167 — blocked.";
    logFailure("isracard", "generic-error", {}, null, { errorType: "GENERIC", errorMessage: raw }, log);
    const text = JSON.stringify(lines);
    assert.ok(text.includes("ProxyRequestHandler.ashx"), "the path is the useful part — keep it");
    assert.ok(!text.includes("shovarRatz"));
    assert.ok(!text.includes("651687167"));
    assert.ok(!text.includes("reqName"));
  });

  test("a 429 automation block is explained without echoing the blocked URL", async () => {
    // The real isracard message, verbatim — it embeds the PirteyIska_204 query
    // string, and shovarRatz is a transaction identifier.
    const raw =
      "Automation detected and blocked by server. Status: 429, URL: " +
      "https://digital.isracard.co.il/services/ProxyRequestHandler.ashx?reqName=PirteyIska_204" +
      "&CardIndex=0&shovarRatz=651687167&moedChiuv=072026. The site is actively blocking access";
    const factory = stubFactory({
      result: { success: false, errorType: "GENERIC", errorMessage: raw },
    });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { body } = await postScrape(base, VALID_BODY);
      assert.equal(body.errorType, "generic-error");
      assert.match(body.errorMessage, /rate-limited/i);
      // The advice deliberately does NOT tell the user to turn extra details
      // off any more: the governor absorbs a 429 on the enrichment pass, so one
      // that still surfaces as a scrape failure hit the login or the
      // transaction fetch, where that switch changes nothing.
      assert.match(body.errorMessage, /login or the transaction fetch/i);
      assert.doesNotMatch(body.errorMessage, /turn(ed)? off|shorter lookback/i);
      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes("shovarRatz"));
      assert.ok(!serialized.includes("651687167"));
      assert.ok(!serialized.includes("isracard.co.il"));
    });
  });

  test("extra transaction details are off unless the caller opts in", async () => {
    const seen = [];
    const factory = (options) => {
      seen.push(options.additionalTransactionInformation);
      return { scrape: async () => ({ success: true, accounts: [] }) };
    };
    await withServer({ scraperFactory: factory }, async (base) => {
      await postScrape(base, VALID_BODY);
      await postScrape(base, { ...VALID_BODY, additionalTransactionInformation: true });
    });
    assert.deepEqual(seen, [false, true]);
  });

  test("a successful scrape reports what the enrichment pass did", async () => {
    // The stub never issues a fetch, so the counts are all zero — what matters
    // here is that the block is on the wire at all, since run_sync reads it to
    // decide whether enrichment applied to this provider.
    const factory = stubFactory({ result: { success: true, accounts: [] } });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { body } = await postScrape(base, {
        ...VALID_BODY,
        additionalTransactionInformation: true,
        enrichedIdentifiers: ["651687167"],
        enrichmentBudgetSeconds: 120,
      });
      assert.deepEqual(body.enrichment, {
        requested: 0,
        skipped: 0,
        enriched: 0,
        deferred: 0,
        stopped: null,
        spentMs: 0,
      });
      // The caller's identifiers are a skip set, not something to echo back.
      assert.ok(!JSON.stringify(body).includes("651687167"));
    });
  });

  test("scrape() throwing classifies via classifyError and leaks nothing", async () => {
    const factory = stubFactory({
      scrapeError: new Error("Navigation timeout of 30000 ms exceeded at https://bank.example"),
    });
    await withServer({ scraperFactory: factory }, async (base) => {
      const { status, body } = await postScrape(base, VALID_BODY);
      assert.equal(status, 200);
      assert.equal(body.errorType, "timeout");
      assert.deepEqual(body.transactions, []);
      assert.ok(!JSON.stringify(body).includes("bank.example"));
    });
  });
});

// ── auth middleware + /health ────────────────────────────────────────────────

describe("auth", () => {
  const factory = () => stubFactory({ result: SUCCESS_RESULT });

  test("with a token set: missing or wrong Authorization → 401", async () => {
    await withServer({ scraperFactory: factory(), token: "sekret" }, async (base) => {
      const missing = await postScrape(base, VALID_BODY);
      assert.equal(missing.status, 401);
      const wrong = await postScrape(base, VALID_BODY, { authorization: "Bearer nope" });
      assert.equal(wrong.status, 401);
    });
  });

  test("with a token set: correct Bearer token passes", async () => {
    await withServer({ scraperFactory: factory(), token: "sekret" }, async (base) => {
      const { status } = await postScrape(base, VALID_BODY, {
        authorization: "Bearer sekret",
      });
      assert.equal(status, 200);
    });
  });

  test("no token configured = open access (documented behavior)", async () => {
    await withServer({ scraperFactory: factory(), token: "" }, async (base) => {
      const { status } = await postScrape(base, VALID_BODY);
      assert.equal(status, 200);
    });
  });

  test("/health is reachable without auth even when a token is set", async () => {
    await withServer({ scraperFactory: factory(), token: "sekret" }, async (base) => {
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: "ok" });
    });
  });
});

// ── every emitted line carries a timestamp (#151) ────────────────────────────

// A puppeteer Page stand-in that only does what attachTrace uses: register
// handlers by event name, and let the test fire them.
function fakePage() {
  const handlers = {};
  return {
    on: (event, fn) => {
      (handlers[event] ||= []).push(fn);
    },
    once: () => {},
    emit: (event, arg) => (handlers[event] || []).forEach((fn) => fn(arg)),
  };
}

const ISO_8601_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("log timestamps", () => {
  test("withTimestamp prefixes the format string and keeps every argument", () => {
    const calls = [];
    const stamped = withTimestamp((...args) => calls.push(args), () => "2026-07-31T20:35:00.000Z");
    const boom = new Error("browser disconnected");

    // The trailing `boom` has no %s of its own — console.error appends such
    // extras, and that behaviour must survive the wrapping.
    stamped("[scrape %s] underlying error:", "visaCal", boom);

    assert.deepEqual(calls, [
      ["%s [scrape %s] underlying error:", "2026-07-31T20:35:00.000Z", "visaCal", boom],
    ]);
  });

  test("the stamp is a real ISO-8601 instant, not a rendered string", () => {
    const calls = [];
    withTimestamp((...args) => calls.push(args))("[trace] nav  %s", "https://example.com/");

    const stamp = calls[0][1];
    assert.match(stamp, ISO_8601_MS);
    // Absolute wall clock, so these lines can be lined up against the backend's.
    assert.ok(Math.abs(Date.parse(stamp) - Date.now()) < 60_000);
  });

  test("every [trace] line is stamped — nav, request and response alike", () => {
    const lines = [];
    const page = fakePage();
    attachTrace(page, (...args) => lines.push(args), "first-party");

    page.emit("framenavigated", { url: () => "https://www.max.co.il/login" });
    page.emit("request", {
      resourceType: () => "xhr",
      method: () => "POST",
      url: () => "https://www.max.co.il/api/login/login",
    });
    page.emit("response", {
      request: () => ({ resourceType: () => "xhr" }),
      status: () => 429,
      url: () => "https://digital.isracard.co.il/services/ProxyRequestHandler.ashx",
    });

    assert.equal(lines.length, 3, "expected nav + request + response");
    for (const [format, stamp] of lines) {
      assert.ok(format.startsWith("%s [trace] "), `unstamped trace line: ${format}`);
      assert.match(stamp, ISO_8601_MS);
    }
  });

  test("trace timestamps advance, so a gap in the timeline is measurable", () => {
    // The whole point of #151: two lines must be distinguishable in time, not
    // just in order. A clock sampled once at attach would defeat that.
    const stamps = [];
    let tick = 0;
    const stamped = withTimestamp(
      (_format, stamp) => stamps.push(stamp),
      () => new Date(1_780_000_000_000 + tick++ * 2_500).toISOString(),
    );

    stamped("[trace] ->   %s", "a");
    stamped("[trace] ->   %s", "b");

    assert.equal(Date.parse(stamps[1]) - Date.parse(stamps[0]), 2_500);
  });

  test("[scrape …] failure lines are stamped without losing their evidence", () => {
    const lines = [];
    const log = (...args) => lines.push(args);
    const result = { errorType: "GENERIC", errorMessage: "Block Automation" };

    logFailure("isracard", "generic-error", {}, null, result, log);

    for (const [format, stamp] of lines) {
      assert.ok(format.startsWith("%s [scrape "), `unstamped scrape line: ${format}`);
      assert.match(stamp, ISO_8601_MS);
    }
    // The library's own errorType/errorMessage still reach the log.
    assert.ok(lines.some((args) => args.includes("GENERIC") && args.includes("Block Automation")));
  });

  test("SCRAPER_TRACE=off still emits nothing at all", () => {
    const lines = [];
    const page = fakePage();
    attachTrace(page, (...args) => lines.push(args), "off");

    page.emit("framenavigated", { url: () => "https://www.max.co.il/login" });
    assert.deepEqual(lines, []);
  });
});
