// Governs the isracard/amex per-transaction enrichment fetch.
//
// `additionalTransactionInformation: true` makes the library fire one
// PirteyIska_204 request per transaction PER MONTH PER CARD, in Promise.all
// bursts of 10 (RATE_LIMIT.TRANSACTIONS_BATCH_SIZE in the library's
// base-isracard-amex.js). That is ~90% of all traffic those providers generate,
// against ~15 requests for the transactions themselves. It runs AFTER the
// transactions were already fetched successfully — so when the provider answers
// 429, the library throws and a scrape that had fully worked is discarded (#149).
//
// The library exposes no knob for any of this: RATE_LIMIT is a module-level
// const and getExtraScrapAccount loops every card unconditionally. But it does
// route every one of those requests through ONE function — fetchGetWithinPage in
// helpers/fetch.js — and its compiled CommonJS calls it as
// `(0, _fetch.fetchGetWithinPage)(page, url)`, a property read at CALL time. So
// replacing that property on the shared module object puts us in the middle of
// every enrichment request, and the library keeps calling whatever is there.
//
// The other half of why this works is already in the library:
//
//     async function getExtraScrapTransaction(page, options, ...) {
//       const data = await fetchGetWithinPage(page, url.toString());
//       if (!data) { return transaction; }        // <- unenriched, but INTACT
//
// A null return is the library's own "no extra details, keep the transaction"
// path. So the governor never has to throw to decline a request: it returns
// null and the transaction survives, which is exactly the priority order this
// needs — categories are worth having, transactions are worth more.
//
// What the governor does with that position:
//   * skips transactions the caller already has enriched (zero requests),
//   * flattens the library's 10-wide bursts into ONE paced serial stream,
//   * stops when a wall-clock budget runs out, keeping what it got,
//   * swallows a 429 and declines the rest of the run instead of failing it.
//
// Requests that are NOT enrichment — login, DashboardMonth,
// CardsTransactionsList — pass straight through untouched. Those ARE the
// transactions; they must never be paced, skipped or swallowed.

import { AsyncLocalStorage } from "node:async_hooks";
import fetchHelpers from "israeli-bank-scrapers/lib/helpers/fetch.js";

// The reqName that identifies a per-transaction enrichment fetch, and the query
// parameter carrying the transaction identifier the caller keys its skip set on.
// Both come from the library's getExtraScrapTransaction(); scraper/test/
// enrichment.test.js pins them against the real module.
export const ENRICHMENT_REQ_NAME = "PirteyIska_204";
export const IDENTIFIER_PARAM = "shovarRatz";

// Serial pacing between enrichment requests. The library's own inter-batch sleep
// is 2500ms for a batch of 10; this is per request, so it is deliberately slower
// than what got us blocked.
export const DEFAULT_DELAY_MS = 4000;

const store = new AsyncLocalStorage();

export function isEnrichmentUrl(url) {
  try {
    return new URL(url).searchParams.get("reqName") === ENRICHMENT_REQ_NAME;
  } catch {
    return false;
  }
}

// The transaction identifier this request is enriching. Returns "" for anything
// unparseable, which never matches a skip entry — so a URL we don't understand
// is fetched rather than silently dropped.
export function identifierOf(url) {
  try {
    return (new URL(url).searchParams.get(IDENTIFIER_PARAM) ?? "").trim();
  } catch {
    return "";
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // The pacing gap that trails the final request must not hold the process
    // open on its own.
    timer.unref?.();
  });
}

export class EnrichmentGovernor {
  #skip;
  #budgetSeconds;
  #deadline = null;
  #startedAt = null;
  #delayMs;
  #sleep;
  #now;
  #chain = Promise.resolve();
  #stopped = null;

  /**
   * @param enrichedIdentifiers identifiers the caller already has enriched — skipped for free.
   * @param budgetSeconds wall-clock ceiling for this run's enrichment; null means no ceiling.
   * @param delayMs pause between consecutive enrichment requests.
   */
  constructor({
    enrichedIdentifiers = [],
    budgetSeconds = null,
    delayMs = DEFAULT_DELAY_MS,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = {}) {
    this.#skip = new Set(enrichedIdentifiers.map((id) => String(id).trim()));
    this.#budgetSeconds = budgetSeconds;
    this.#delayMs = delayMs;
    this.#sleep = sleep;
    this.#now = now;
    this.stats = { requested: 0, skipped: 0, enriched: 0, deferred: 0, stopped: null, spentMs: 0 };
  }

  // The clock starts at the first enrichment request, NOT at construction:
  // logging in and fetching the transactions happens in between, and a slow
  // login must not silently consume the enrichment budget. What the caller is
  // buying is N seconds of enrichment.
  #startClock() {
    if (this.#startedAt != null) return;
    this.#startedAt = this.#now();
    this.#deadline =
      this.#budgetSeconds == null ? null : this.#startedAt + this.#budgetSeconds * 1000;
  }

  // Why enrichment is over, or null while it is still running. Latches: once a
  // 429 has been seen the block is IP-level and sustained (#149 — a later
  // attempt was 429'd on ValidateIdData, before login), so there is nothing to
  // be gained by trying the next transaction.
  #stopReason() {
    if (this.#stopped) return this.#stopped;
    if (this.#deadline != null && this.#now() >= this.#deadline) {
      this.#stopped = "budget";
      return this.#stopped;
    }
    return null;
  }

  #decline() {
    this.stats.deferred += 1;
    this.stats.stopped = this.#stopped;
    if (this.#startedAt != null) this.stats.spentMs = this.#now() - this.#startedAt;
    return null;
  }

  // One slot, `delayMs` apart. The library hands us ten concurrent calls at a
  // time; they queue here and leave one at a time.
  #enqueue(task) {
    const started = this.#chain.then(task, task);
    this.#chain = started.then(
      () => this.#sleep(this.#delayMs),
      () => this.#sleep(this.#delayMs),
    );
    return started;
  }

  /**
   * @param fetchOnce thunk performing the real request — injected so tests never need a page.
   */
  async handle(fetchOnce, url) {
    this.stats.requested += 1;

    // Free: costs no request and no queue wait, so it does not start the clock.
    if (this.#skip.has(identifierOf(url))) {
      this.stats.skipped += 1;
      return null;
    }

    this.#startClock();
    if (this.#stopReason()) return this.#decline();

    return this.#enqueue(async () => {
      // Re-checked here rather than only above: ten callers pass the gate
      // together, and the budget can run out while they wait their turn.
      if (this.#stopReason()) return this.#decline();
      try {
        const data = await fetchOnce();
        this.stats.enriched += 1;
        // What this account actually spent, so the caller can hand the unused
        // remainder of a shared budget to the next account instead of losing it.
        this.stats.spentMs = this.#now() - this.#startedAt;
        return data;
      } catch {
        // The error is deliberately not inspected or logged. It is built from
        // the request URL — the isracard 429 message embeds the full
        // PirteyIska_204 query string, shovarRatz and all — and CLAUDE.md keeps
        // that out of the container log. What it was is not in question here:
        // the only enrichment failure mode that matters is "stop asking".
        this.#stopped = "blocked";
        return this.#decline();
      }
    });
  }
}

// Runs `fn` with `governor` installed for every enrichment request made beneath
// it. AsyncLocalStorage rather than a module-level "current run" so two
// concurrent /scrape requests can never share a budget or a skip set.
export function runWithGovernor(governor, fn) {
  return store.run(governor, fn);
}

// Counts only — never the URL, the identifier or the provider's message.
export function summarizeEnrichment(stats) {
  const reason = stats.stopped ? ` (stopped: ${stats.stopped})` : "";
  return (
    `${stats.enriched} enriched · ${stats.skipped} already had one · ` +
    `${stats.deferred} deferred${reason}`
  );
}

export function install(target = fetchHelpers) {
  const original = target.fetchGetWithinPage;
  if (typeof original !== "function") {
    throw new Error(
      "israeli-bank-scrapers no longer exports fetchGetWithinPage from " +
        "lib/helpers/fetch.js — the enrichment governor is not installed and " +
        "every transaction would be enriched unpaced. See scraper/src/enrichment.js.",
    );
  }
  target.fetchGetWithinPage = function governedFetchGetWithinPage(page, url, ignoreErrors) {
    const governor = store.getStore();
    if (!governor || !isEnrichmentUrl(url)) return original(page, url, ignoreErrors);
    return governor.handle(() => original(page, url, ignoreErrors), url);
  };
  return original;
}

// Installed on import, once, before any scraper is constructed. Harmless when no
// governor is active: without a store the wrapper is a straight pass-through.
install();
