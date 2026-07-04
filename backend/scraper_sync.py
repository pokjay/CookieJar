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

logger = logging.getLogger(__name__)

_SCRAPER_URL = os.getenv("SCRAPER_URL", "http://scraper:3000")
_SCRAPER_TOKEN = os.getenv("SCRAPER_TOKEN", "")
_SCRAPER_TZ = os.getenv("SCRAPER_TZ", "Asia/Jerusalem")


def _parse_tx_date(raw_date: str) -> date | None:
    """Parse a scraper tx date (Node's JSON.stringify UTC ISO string, e.g.
    "2026-05-31T21:00:00.000Z") into a local calendar date.

    moneyman derives its yyyy-MM-dd from local time, so a tz-aware value is
    converted to SCRAPER_TZ before truncating to a date - otherwise a
    local-midnight transaction serialized as the previous day's UTC evening
    would land on the wrong date. Returns None (falling back to the raw string)
    for naive datetimes, which carry no offset to convert from, and for
    unparseable strings.
    """
    try:
        dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if dt.tzinfo is None:
        return None
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


def _scrape_account(credential: dict, start_date: str) -> dict:
    """POST to the scraper sidecar for a single account."""
    headers = {}
    if _SCRAPER_TOKEN:
        headers["Authorization"] = f"Bearer {_SCRAPER_TOKEN}"
    with httpx.Client(timeout=300) as client:
        resp = client.post(
            f"{_SCRAPER_URL}/scrape",
            json={"account": credential, "startDate": start_date},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


def _build_transaction_row(tx: dict, company_id: str, account_number: str) -> dict:
    """Map a scraped transaction into the row shape upsert_transactions() expects."""
    uid = transaction_unique_id(tx, company_id, account_number)

    raw_date = tx.get("date", "")
    parsed_date = _parse_tx_date(raw_date)
    activity_date = parsed_date if parsed_date else raw_date

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
    }


def run_sync(credentials: list[dict], run_id: str, lookback_days: int) -> None:
    """Background task: scrape each account and upsert transactions.

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

    try:
        for credential in credentials:
            company_id = credential.get("companyId", "")
            account_title = credential.get("accountTitle", "")

            insert_run_account(run_id, account=account_title, company_id=company_id)

            try:
                result = _scrape_account(credential, start_date)
            except httpx.ConnectError:
                logger.error("Scraper service unreachable for %s/%s", company_id, account_title)
                finish_run_account(run_id, account_title, company_id, "error", "unavailable", 0)
                account_statuses.append("error")
                continue
            except Exception as exc:
                logger.error("Scraper request failed for %s/%s: %s", company_id, account_title, exc)
                finish_run_account(run_id, account_title, company_id, "error", "unknown", 0)
                account_statuses.append("error")
                continue

            error_type = result.get("errorType")
            if error_type:
                finish_run_account(run_id, account_title, company_id, "error", error_type, 0)
                account_statuses.append("error")
                continue

            # Sub-accounts under one credential each carry their own accountNumber;
            # the top-level accountNumber is only the first sub-account's, so it's
            # merely a fallback for transactions missing their own.
            top_level_account_number = result.get("accountNumber")
            txns = result.get("transactions", [])
            try:
                rows = [
                    _build_transaction_row(
                        tx,
                        company_id,
                        tx.get("accountNumber") or top_level_account_number or account_title,
                    )
                    for tx in txns
                ]
                imported = upsert_transactions(rows)
            except Exception as exc:
                logger.error("Upsert failed for %s/%s: %s", company_id, account_title, exc)
                finish_run_account(run_id, account_title, company_id, "error", "db_error", 0)
                account_statuses.append("error")
                continue

            finish_run_account(run_id, account_title, company_id, "success", None, imported)
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
