"""Orchestrates a scraper sync run as a background task."""

import json
import logging
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from backend.cache import clear_all
from src.db.connection import is_mock_mode
from src.db.mutations.scraper import (
    finish_run,
    finish_run_account,
    insert_run_account,
    upsert_transactions,
)
from src.db.queries.scraper import enriched_identifiers, pending_enrichment_count

logger = logging.getLogger(__name__)

_SCRAPER_URL = os.getenv("SCRAPER_URL", "http://scraper:3000")
_SCRAPER_TOKEN = os.getenv("SCRAPER_TOKEN", "")
_SCRAPER_TZ = os.getenv("SCRAPER_TZ", "Asia/Jerusalem")
# Per-account HTTP timeout for the scraper sidecar call. additionalTransactionInformation
# adds ~3s per transaction (one serial extra request each), so a busy card can take
# several minutes; the old 300s ceiling was too tight. Keep it well under the 15-minute
# stale-run guard (mark_stale_runs) that bounds a whole sync.
_SCRAPER_HTTP_TIMEOUT = float(os.getenv("SCRAPER_HTTP_TIMEOUT", "600"))

# Wall-clock ceiling on the bank-category pass for a WHOLE run, shared out
# between the accounts that need it (see _budget_slice below).
#
# Global rather than per-account because both ceilings this has to fit inside
# are global-ish: mark_stale_runs() abandons a run after 15 minutes, and
# SCRAPER_HTTP_TIMEOUT bounds a single account at 600s. Four accounts spending
# ~90s each on their transactions leaves ~660s total at this budget, and ~390s
# for the worst single account - both comfortably inside, which is why neither
# ceiling had to move.
#
# Hitting the budget is not a failure: enrichment stops, the transactions are
# kept, and the next sync over the same window picks up where this one stopped.
_ENRICHMENT_BUDGET_SECONDS = float(os.getenv("SCRAPER_ENRICHMENT_BUDGET_SECONDS", "300"))

# Pause between consecutive enrichment requests inside the sidecar. The library's
# own pacing was 2.5s between BATCHES OF TEN; this is per request, and the whole
# point is to be slower than what got us rate-limited.
_ENRICHMENT_DELAY_MS = int(os.getenv("SCRAPER_ENRICHMENT_DELAY_MS", "4000"))

# Providers with a per-transaction enrichment pass worth budgeting for. The
# others either supply their category with the transaction itself (visaCal's
# branchCodeDesc) or have none at all, so they never spend enrichment time and
# must not be given a slice of the budget or shown a backlog counter.
ENRICHING_COMPANIES = frozenset({"isracard", "amex"})


def _parse_tx_date(raw_date: str) -> date | None:
    """Parse a scraper tx date (Node's JSON.stringify UTC ISO string, e.g.
    "2026-05-31T21:00:00.000Z") into a local calendar date.

    moneyman derives its yyyy-MM-dd from local time, so a tz-aware value is
    converted to SCRAPER_TZ before truncating to a date - otherwise a
    local-midnight transaction serialized as the previous day's UTC evening
    would land on the wrong date. A naive datetime carries no offset, meaning
    it already is local wall time, so it truncates directly. Returns None only
    for unparseable strings.
    """
    try:
        dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if dt.tzinfo is None:
        return dt.date()
    return dt.astimezone(ZoneInfo(_SCRAPER_TZ)).date()


def transaction_unique_id(tx: dict, company_id: str, account_number: str) -> str:
    """Replicate moneyman's transactionUniqueId from src/bot/storage/utils.ts.

    Format: YYYY-MM-DD_companyId_accountNumber_chargedAmount_identifier
    where identifier = tx.identifier || (tx.description + "_" + tx.memo)
    Each part is str(p ?? "").strip(), joined with "_".
    """
    raw_date = tx.get("date", "")
    parsed_date = _parse_tx_date(raw_date)
    date_str = parsed_date.strftime("%Y-%m-%d") if parsed_date else str(raw_date).strip()

    identifier = tx.get("identifier") or (f"{tx.get('description', '')}_{tx.get('memo', '')}")

    parts = [
        date_str,
        company_id,
        account_number,
        tx.get("chargedAmount"),
        identifier,
    ]
    return "_".join(str(p if p is not None else "").strip() for p in parts)


def _scrape_account(
    credential: dict,
    start_date: str,
    additional_transaction_info: bool = False,
    enriched_ids: list[str] | None = None,
    enrichment_budget_seconds: float | None = None,
) -> dict:
    """POST to the scraper sidecar for a single account.

    enriched_ids are transaction identifiers we already have a bank category
    for; the sidecar skips those without spending a request, which is what makes
    a steady-state sync cost a handful of enrichment calls instead of hundreds.
    Only this side knows them - the sidecar has no database.
    """
    headers = {}
    if _SCRAPER_TOKEN:
        headers["Authorization"] = f"Bearer {_SCRAPER_TOKEN}"
    with httpx.Client(timeout=_SCRAPER_HTTP_TIMEOUT) as client:
        resp = client.post(
            f"{_SCRAPER_URL}/scrape",
            json={
                "account": credential,
                "startDate": start_date,
                "additionalTransactionInformation": additional_transaction_info,
                "enrichedIdentifiers": enriched_ids or [],
                "enrichmentBudgetSeconds": enrichment_budget_seconds,
                "enrichmentDelayMs": _ENRICHMENT_DELAY_MS,
            },
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


def _bank_category(tx: dict) -> str | None:
    """The provider's category for this transaction, or None if it was not asked.

    See the comment at the call site: None and "" mean genuinely different
    things here, and conflating them makes the enrichment backlog unable to
    reach zero.
    """
    raw = tx.get("category")
    return None if raw is None else str(raw).strip()


def _build_transaction_row(tx: dict, company_id: str, account_number: str) -> dict | None:
    """Map a scraped transaction into the row shape upsert_transactions() expects.

    Returns None when the tx date can't be parsed: activity_date is a DATE NOT
    NULL column, so an unparseable value would abort the account's whole
    batched insert. The caller skips (and logs) such transactions instead.
    """
    raw_date = tx.get("date", "")
    activity_date = _parse_tx_date(raw_date)
    if activity_date is None:
        return None

    uid = transaction_unique_id(tx, company_id, account_number)

    return {
        "unique_id": uid,
        "company_id": company_id,
        "account": account_number,
        "status": tx.get("status", "completed"),
        "activity_date": activity_date,
        "charged_amount": tx.get("chargedAmount"),
        "charged_currency": tx.get("chargedCurrency"),
        "original_amount": tx.get("originalAmount"),
        "original_currency": tx.get("originalCurrency"),
        "description": tx.get("description"),
        "memo": tx.get("memo"),
        "identifier": tx.get("identifier"),
        "installments": (json.dumps(tx.get("installments")) if tx.get("installments") else None),
        "raw": json.dumps(tx),
        # The provider's own category, promoted out of `raw` so it is queryable
        # and so the next sync can tell which transactions it has already paid
        # to enrich.
        #
        # The absent/empty distinction is load-bearing, and the sidecar hands it
        # to us for free. getExtraScrapTransaction only adds a `category` key
        # when its fetch actually returned data; a transaction the governor
        # skipped, deferred or never enriched comes back with no such key at
        # all. So:
        #
        #   key missing -> NULL, "we never asked" - still owed an enrichment,
        #                  and the upsert's COALESCE keeps whatever we already
        #                  knew rather than erasing it
        #   key present -> the provider's answer, INCLUDING "" for a transaction
        #                  it has no category for. Storing that empty answer is
        #                  what stops us re-asking the same hopeless question
        #                  every sync and reporting it as a backlog forever.
        "bank_category": _bank_category(tx),
    }


def _enriching(company_id: str, additional_transaction_info: bool) -> bool:
    """Whether the bank-category pass applies to this account at all."""
    return additional_transaction_info and company_id in ENRICHING_COMPANIES


def _budget_slice(remaining: float, accounts_left: int) -> float:
    """This account's share of what is left of the run's enrichment budget.

    An even split among the accounts that still need enriching, rather than
    "whatever is left": handing the whole budget to the first account would let
    it converge while the last one never starts, and the UI would show a backlog
    that never moves. Whatever an account does not spend flows back to the pool
    for the ones after it.
    """
    return max(0.0, remaining) / max(1, accounts_left)


def run_sync(
    credentials: list[dict],
    run_id: str,
    lookback_days: int,
    additional_transaction_info: bool = True,
) -> None:
    """Background task: scrape each account and upsert transactions.

    additional_transaction_info asks the sidecar for the provider's
    per-transaction extra details - the bank category. It used to default off
    because a 429 during that pass failed the whole scrape even though the
    transactions had already been fetched successfully (#149). The sidecar's
    enrichment governor now absorbs that 429 and returns the transactions
    unenriched, and the pass is budgeted, so the reason for the old default is
    gone.

    The budget is per RUN, not per account, and it is shared out as the loop
    goes. An account that runs out keeps the categories it collected; the next
    sync over the same window skips those and advances from there, so a large
    backlog converges over several syncs rather than needing one long one.

    Guarantees the run is always finished (never left 'running' forever): the
    account loop and overall-status computation run under try/finally, so an
    unexpected exception - e.g. from insert_run_account or finish_run_account,
    outside the per-account error handling below - still finishes the run as
    'error' and still clears the cache.
    """
    if is_mock_mode():
        return

    start_date = (date.today() - timedelta(days=lookback_days)).isoformat()
    account_statuses: list[str] = []

    enrichment_budget_left = _ENRICHMENT_BUDGET_SECONDS
    accounts_to_enrich = sum(
        1 for c in credentials if _enriching(c.get("companyId", ""), additional_transaction_info)
    )

    try:
        for credential in credentials:
            company_id = credential.get("companyId", "")
            account_title = credential.get("accountTitle", "")

            insert_run_account(run_id, account=account_title, company_id=company_id)

            enriching = _enriching(company_id, additional_transaction_info)
            enriched_ids: list[str] = []
            account_budget: float | None = None
            if enriching:
                # Everything already enriched in this window is a request the
                # sidecar does not have to make. In steady state this is nearly
                # the whole window, which is what collapses the cost.
                enriched_ids = enriched_identifiers(company_id, start_date)
                account_budget = _budget_slice(enrichment_budget_left, accounts_to_enrich)
                accounts_to_enrich -= 1

            try:
                result = _scrape_account(
                    credential,
                    start_date,
                    additional_transaction_info,
                    enriched_ids,
                    account_budget,
                )
            except httpx.ConnectError:
                logger.error("Scraper service unreachable for %s/%s", company_id, account_title)
                finish_run_account(
                    run_id,
                    account_title,
                    company_id,
                    "error",
                    "unavailable",
                    0,
                    "The scraper service is not reachable. Check that the scraper "
                    "container is running.",
                )
                account_statuses.append("error")
                continue
            except Exception as exc:
                logger.error("Scraper request failed for %s/%s: %s", company_id, account_title, exc)
                finish_run_account(
                    run_id,
                    account_title,
                    company_id,
                    "error",
                    "unknown",
                    0,
                    "The request to the scraper service failed. Check the backend logs.",
                )
                account_statuses.append("error")
                continue

            error_type = result.get("errorType")
            if error_type:
                finish_run_account(
                    run_id,
                    account_title,
                    company_id,
                    "error",
                    error_type,
                    0,
                    result.get("errorMessage"),
                )
                account_statuses.append("error")
                continue

            # Sub-accounts under one credential each carry their own accountNumber;
            # the top-level accountNumber is only the first sub-account's, so it's
            # merely a fallback for transactions missing their own.
            top_level_account_number = result.get("accountNumber")
            txns = result.get("transactions", [])
            try:
                maybe_rows = [
                    _build_transaction_row(
                        tx,
                        company_id,
                        tx.get("accountNumber") or top_level_account_number or account_title,
                    )
                    for tx in txns
                ]
                rows = [r for r in maybe_rows if r is not None]
                skipped = len(maybe_rows) - len(rows)
                if skipped:
                    logger.warning(
                        "Skipped %d transaction(s) with unparseable dates for %s/%s",
                        skipped,
                        company_id,
                        account_title,
                    )
                imported, refreshed = upsert_transactions(rows)
                if refreshed:
                    logger.info(
                        "Refreshed %d existing transaction(s) for %s/%s",
                        refreshed,
                        company_id,
                        account_title,
                    )
            except Exception as exc:
                logger.error("Upsert failed for %s/%s: %s", company_id, account_title, exc)
                finish_run_account(
                    run_id,
                    account_title,
                    company_id,
                    "error",
                    "db_error",
                    0,
                    "The transactions were scraped but could not be written to the database.",
                )
                account_statuses.append("error")
                continue

            # What the enrichment pass cost and how far it got. `missing` is read
            # back from the database rather than taken from the sidecar's own
            # count, because the sidecar sees one scrape and the backlog is a
            # property of the window: transactions stored by earlier runs that
            # still have no category are part of it too.
            enrichment_added: int | None = None
            enrichment_missing: int | None = None
            if enriching:
                stats = result.get("enrichment") or {}
                enrichment_budget_left -= stats.get("spentMs", 0) / 1000
                enrichment_added = stats.get("enriched", 0)
                enrichment_missing = pending_enrichment_count([r["unique_id"] for r in rows])

            finish_run_account(
                run_id,
                account_title,
                company_id,
                "success",
                None,
                imported,
                None,
                enrichment_added,
                enrichment_missing,
            )
            account_statuses.append("success")

        if not account_statuses or all(s == "error" for s in account_statuses):
            overall = "error"
        elif all(s == "success" for s in account_statuses):
            overall = "success"
        else:
            overall = "partial"

        finish_run(run_id, overall)
    except Exception:
        logger.exception("Unexpected error during scraper sync run %s", run_id)
        finish_run(run_id, "error")
    finally:
        clear_all()
