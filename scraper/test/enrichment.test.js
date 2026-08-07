import { describe, test } from "node:test";
import assert from "node:assert/strict";

// The module the governor reaches into. Imported here for the pinning tests
// below: if a library bump moves or renames fetchGetWithinPage, the governor
// silently stops governing and every transaction gets enriched unpaced again —
// which is the exact failure #149 is about. These tests make that loud.
import fetchHelpers from "israeli-bank-scrapers/lib/helpers/fetch.js";

import {
  DEFAULT_DELAY_MS,
  ENRICHMENT_REQ_NAME,
  EnrichmentGovernor,
  identifierOf,
  install,
  isEnrichmentUrl,
  runWithGovernor,
  summarizeEnrichment,
} from "../src/enrichment.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const SERVICES = "https://digital.isracard.co.il/services/ProxyRequestHandler.ashx";

function enrichUrl(identifier, { cardIndex = 0, month = "082026" } = {}) {
  const url = new URL(SERVICES);
  url.searchParams.set("reqName", ENRICHMENT_REQ_NAME);
  url.searchParams.set("CardIndex", String(cardIndex));
  url.searchParams.set("shovarRatz", String(identifier));
  url.searchParams.set("moedChiuv", month);
  return url.toString();
}

function otherUrl(reqName) {
  const url = new URL(SERVICES);
  url.searchParams.set("reqName", reqName);
  return url.toString();
}

// A governor whose clock and sleep are driven by the test rather than the
// wall, so budget behaviour is asserted without the suite actually waiting.
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    sleep: async (ms) => {
      now += ms;
    },
  };
}

// ── the interception point the whole design rests on ─────────────────────────

describe("library interception point", () => {
  test("fetchGetWithinPage is still exported, writable and configurable", () => {
    // install() replaced the property, so what's there now is the wrapper —
    // the point is that the slot exists and can be swapped.
    const descriptor = Object.getOwnPropertyDescriptor(fetchHelpers, "fetchGetWithinPage");
    assert.equal(typeof descriptor.value, "function");
    assert.equal(descriptor.writable, true, "the governor could not be installed");
    assert.equal(descriptor.configurable, true);
  });

  test("install() refuses to pretend it worked when the export is gone", () => {
    assert.throws(
      () => install({}),
      /no longer exports fetchGetWithinPage/,
      "a library bump that drops the export must fail loudly, not silently disable pacing",
    );
  });

  test("the installed wrapper passes through when no governor is active", async () => {
    const calls = [];
    const target = {
      fetchGetWithinPage: async (page, url, ignoreErrors) => {
        calls.push([url, ignoreErrors]);
        return { ok: true };
      },
    };
    install(target);

    // Enrichment URL, but outside runWithGovernor — must reach the original,
    // with every argument intact.
    const out = await target.fetchGetWithinPage("page", enrichUrl(1), true);
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(calls, [[enrichUrl(1), true]]);
  });
});

// ── URL classification ───────────────────────────────────────────────────────

describe("isEnrichmentUrl", () => {
  test("only PirteyIska_204 counts as enrichment", () => {
    assert.equal(isEnrichmentUrl(enrichUrl(1)), true);
    for (const reqName of ["ValidateIdData", "performLogonI", "DashboardMonth", "CardsTransactionsList"]) {
      assert.equal(isEnrichmentUrl(otherUrl(reqName)), false, reqName);
    }
  });

  test("an unparseable url is not enrichment", () => {
    assert.equal(isEnrichmentUrl("not a url"), false);
    assert.equal(isEnrichmentUrl(undefined), false);
  });
});

describe("identifierOf", () => {
  test("reads shovarRatz", () => {
    assert.equal(identifierOf(enrichUrl(12345)), "12345");
  });

  test("an unreadable identifier is empty, which matches no skip entry", () => {
    assert.equal(identifierOf(otherUrl("DashboardMonth")), "");
    assert.equal(identifierOf("not a url"), "");
  });
});

// ── pass-through ─────────────────────────────────────────────────────────────

describe("non-enrichment requests are untouched", () => {
  test("login and transaction fetches never queue, skip or get swallowed", async () => {
    const governor = new EnrichmentGovernor({
      enrichedIdentifiers: ["1"],
      budgetSeconds: 0, // enrichment is over before it began
      ...fakeClock(),
    });
    const target = {
      fetchGetWithinPage: async (_page, url) => ({ url }),
    };
    install(target);

    await runWithGovernor(governor, async () => {
      for (const reqName of ["ValidateIdData", "DashboardMonth", "CardsTransactionsList"]) {
        const out = await target.fetchGetWithinPage("page", otherUrl(reqName));
        assert.deepEqual(out, { url: otherUrl(reqName) }, `${reqName} must reach the provider`);
      }
    });

    assert.equal(governor.stats.requested, 0, "pass-through must not be counted as enrichment");
  });

  test("a thrown error on a transaction fetch still propagates", async () => {
    const governor = new EnrichmentGovernor(fakeClock());
    const target = {
      fetchGetWithinPage: async () => {
        throw new Error("Automation detected and blocked by server. Status: 429");
      },
    };
    install(target);

    await runWithGovernor(governor, async () => {
      await assert.rejects(
        () => target.fetchGetWithinPage("page", otherUrl("CardsTransactionsList")),
        /429/,
        "swallowing this would hide a real scrape failure",
      );
    });
  });
});

// ── skipping ─────────────────────────────────────────────────────────────────

describe("already-enriched transactions", () => {
  test("are skipped without a request and without waiting", async () => {
    const clock = fakeClock();
    const governor = new EnrichmentGovernor({
      enrichedIdentifiers: ["100", "101"],
      delayMs: 5000,
      ...clock,
    });
    let fetches = 0;
    const fetchOnce = async () => {
      fetches += 1;
      return { PirteyIska_204Bean: { sector: " פארמה " } };
    };

    const results = await Promise.all([
      governor.handle(fetchOnce, enrichUrl(100)),
      governor.handle(fetchOnce, enrichUrl(101)),
    ]);

    assert.deepEqual(results, [null, null], "null is the library's keep-the-transaction path");
    assert.equal(fetches, 0);
    assert.equal(clock.now(), 0, "a skip must not spend pacing time");
    assert.deepEqual(governor.stats, {
      requested: 2,
      skipped: 2,
      enriched: 0,
      deferred: 0,
      stopped: null,
      // A run that only skips never starts the budget clock, so it hands its
      // whole share back to the accounts after it.
      spentMs: 0,
    });
  });

  test("identifiers are compared as trimmed strings, whatever the caller sent", async () => {
    const governor = new EnrichmentGovernor({ enrichedIdentifiers: [100, " 101 "], ...fakeClock() });
    const fetchOnce = async () => ({});

    assert.equal(await governor.handle(fetchOnce, enrichUrl(100)), null);
    assert.equal(await governor.handle(fetchOnce, enrichUrl(101)), null);
    assert.equal(governor.stats.skipped, 2);
  });

  test("an unknown identifier is fetched, never assumed done", async () => {
    const governor = new EnrichmentGovernor({ enrichedIdentifiers: ["100"], ...fakeClock() });
    const out = await governor.handle(async () => ({ sector: "x" }), enrichUrl(999));

    assert.deepEqual(out, { sector: "x" });
    assert.equal(governor.stats.enriched, 1);
    assert.equal(governor.stats.skipped, 0);
  });
});

// ── pacing ───────────────────────────────────────────────────────────────────

describe("pacing", () => {
  test("the library's ten-wide burst leaves one at a time", async () => {
    const clock = fakeClock();
    const governor = new EnrichmentGovernor({ delayMs: 4000, ...clock });

    let inFlight = 0;
    let maxInFlight = 0;
    const fetchOnce = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return {};
    };

    // Exactly how getExtraScrapAccount calls it: Promise.all over a chunk of 10.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => governor.handle(fetchOnce, enrichUrl(i))),
    );

    assert.equal(maxInFlight, 1, "concurrent enrichment is what got us rate-limited");
    assert.equal(governor.stats.enriched, 10);
  });

  test("consecutive requests are spaced by delayMs", async () => {
    const clock = fakeClock();
    const governor = new EnrichmentGovernor({ delayMs: 4000, ...clock });
    const startedAt = [];
    const fetchOnce = async () => {
      startedAt.push(clock.now());
      return {};
    };

    await Promise.all(Array.from({ length: 3 }, (_, i) => governor.handle(fetchOnce, enrichUrl(i))));

    assert.deepEqual(startedAt, [0, 4000, 8000], "first is immediate, then one gap each");
  });

  test("the default gap is slower than the library's own inter-batch sleep", () => {
    // The library sleeps 2500ms between batches of TEN. Per request, ours must
    // be materially slower than that or the change is cosmetic.
    assert.ok(DEFAULT_DELAY_MS > 2500, `${DEFAULT_DELAY_MS}ms is not a slowdown`);
  });
});

// ── budget ───────────────────────────────────────────────────────────────────

describe("time budget", () => {
  test("enrichment stops when the budget runs out and the rest is deferred", async () => {
    const clock = fakeClock();
    // 10s at a 4s gap: requests at t=0 and t=4000 run; by t=8000 it is over.
    const governor = new EnrichmentGovernor({ budgetSeconds: 10, delayMs: 4000, ...clock });
    let fetches = 0;
    const fetchOnce = async () => {
      fetches += 1;
      return {};
    };

    const out = await Promise.all(
      Array.from({ length: 6 }, (_, i) => governor.handle(fetchOnce, enrichUrl(i))),
    );

    assert.equal(fetches, 3, "stopped mid-run rather than pushing on past the budget");
    assert.equal(governor.stats.enriched, 3);
    assert.equal(governor.stats.deferred, 3);
    assert.equal(governor.stats.stopped, "budget");
    assert.deepEqual(out.slice(3), [null, null, null], "deferred transactions still survive");
  });

  test("no budget means no ceiling", async () => {
    const clock = fakeClock();
    const governor = new EnrichmentGovernor({ budgetSeconds: null, delayMs: 1000, ...clock });
    await Promise.all(Array.from({ length: 20 }, (_, i) => governor.handle(async () => ({}), enrichUrl(i))));

    assert.equal(governor.stats.enriched, 20);
    assert.equal(governor.stats.stopped, null);
  });

  test("the clock starts at the first enrichment request, not at construction", async () => {
    const clock = fakeClock();
    const governor = new EnrichmentGovernor({ budgetSeconds: 10, delayMs: 4000, ...clock });

    // Logging in and fetching the transactions happens between construction and
    // the first enrichment request. A slow login must not silently spend the
    // budget the caller paid for.
    clock.advance(120_000);

    const out = await governor.handle(async () => ({ sector: "x" }), enrichUrl(1));
    assert.deepEqual(out, { sector: "x" });
    assert.equal(governor.stats.enriched, 1);
    assert.equal(governor.stats.stopped, null);
  });

  test("reports what it actually spent, so the caller can pass on the remainder", async () => {
    const clock = fakeClock();
    const governor = new EnrichmentGovernor({ budgetSeconds: 60, delayMs: 4000, ...clock });

    await Promise.all(
      Array.from({ length: 3 }, (_, i) => governor.handle(async () => ({}), enrichUrl(i))),
    );

    // Three requests, two pacing gaps between them.
    assert.equal(governor.stats.spentMs, 8000);
  });

  test("an exhausted budget defers everything without a single request", async () => {
    const governor = new EnrichmentGovernor({ budgetSeconds: 0, ...fakeClock() });
    let fetches = 0;

    const out = await governor.handle(async () => {
      fetches += 1;
      return {};
    }, enrichUrl(1));

    assert.equal(out, null);
    assert.equal(fetches, 0);
    assert.equal(governor.stats.stopped, "budget");
  });
});

// ── the 429 ──────────────────────────────────────────────────────────────────

describe("a rate-limited enrichment request", () => {
  test("is absorbed, and every later one is declined without asking again", async () => {
    const clock = fakeClock();
    const governor = new EnrichmentGovernor({ delayMs: 1000, ...clock });
    let fetches = 0;
    const fetchOnce = async () => {
      fetches += 1;
      throw new Error(
        // The real message, query string and all — proof that nothing derived
        // from it reaches the stats or the log.
        "Automation detected and blocked by server. Status: 429, URL: " + enrichUrl(7),
      );
    };

    const out = await Promise.all(
      Array.from({ length: 5 }, (_, i) => governor.handle(fetchOnce, enrichUrl(i))),
    );

    assert.deepEqual(out, [null, null, null, null, null], "the transactions must survive");
    assert.equal(fetches, 1, "the block is IP-level and sustained — asking again only deepens it");
    assert.equal(governor.stats.stopped, "blocked");
    assert.equal(governor.stats.enriched, 0);
    assert.equal(governor.stats.deferred, 5);
  });

  test("the scrape that produced it still completes", async () => {
    const governor = new EnrichmentGovernor(fakeClock());
    const target = {
      fetchGetWithinPage: async (_page, url) => {
        if (isEnrichmentUrl(url)) throw new Error("Status: 429");
        return { CardsTransactionsListBean: {} };
      },
    };
    install(target);

    const finished = await runWithGovernor(governor, async () => {
      await target.fetchGetWithinPage("page", enrichUrl(1));
      // The library would carry on to the next month after a failed enrichment
      // only because we didn't throw — this is the whole point.
      return target.fetchGetWithinPage("page", otherUrl("CardsTransactionsList"));
    });

    assert.deepEqual(finished, { CardsTransactionsListBean: {} });
  });
});

// ── isolation ────────────────────────────────────────────────────────────────

describe("concurrent runs", () => {
  test("two scrapes never share a budget or a skip set", async () => {
    const a = new EnrichmentGovernor({ enrichedIdentifiers: ["1"], ...fakeClock() });
    const b = new EnrichmentGovernor({ enrichedIdentifiers: ["2"], ...fakeClock() });
    const target = { fetchGetWithinPage: async () => ({ ok: true }) };
    install(target);

    const [ra, rb] = await Promise.all([
      runWithGovernor(a, () => target.fetchGetWithinPage("page", enrichUrl(1))),
      runWithGovernor(b, () => target.fetchGetWithinPage("page", enrichUrl(1))),
    ]);

    assert.equal(ra, null, "run A already had identifier 1");
    assert.deepEqual(rb, { ok: true }, "run B had not, and must not inherit A's skip set");
    assert.equal(a.stats.skipped, 1);
    assert.equal(b.stats.enriched, 1);
  });
});

// ── logging ──────────────────────────────────────────────────────────────────

describe("summarizeEnrichment", () => {
  test("reports counts and why it stopped", () => {
    const line = summarizeEnrichment({
      requested: 240,
      skipped: 124,
      enriched: 60,
      deferred: 56,
      stopped: "budget",
    });
    assert.match(line, /60 enriched/);
    assert.match(line, /124 already had one/);
    assert.match(line, /56 deferred/);
    assert.match(line, /stopped: budget/);
  });

  test("leaks no identifier, url or query string", () => {
    const line = summarizeEnrichment({
      requested: 1,
      skipped: 0,
      enriched: 0,
      deferred: 1,
      stopped: "blocked",
    });
    assert.ok(!line.includes("shovarRatz"), line);
    assert.ok(!line.includes("http"), line);
    assert.ok(!line.includes(ENRICHMENT_REQ_NAME), line);
  });
});
