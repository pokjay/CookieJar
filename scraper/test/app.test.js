import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

// ScraperErrorTypes isn't re-exported from the package root, hence the deep
// import. If a library bump breaks this path, that's a signal the error
// vocabulary may have moved too — update LIBRARY_ERROR_TYPE_MAP alongside it.
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";

import {
  classifyError,
  createApp,
  LIBRARY_ERROR_TYPE_MAP,
  mapLibraryErrorType,
  preparePage,
  SAFE_ERROR_TYPES,
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
      assert.equal(options.preparePage, preparePage);
      assert.equal(options.showBrowser, false);
    });
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
      assert.deepEqual(Object.keys(body).sort(), ["accountNumber", "errorType", "transactions"]);
      const raw = JSON.stringify(body);
      assert.ok(!raw.includes("hunter2-secret"));
      assert.ok(!raw.includes("user-1"));
      assert.ok(!raw.includes("Request Rejected"));
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
