"""Orchestrates a scraper sync run as a background task."""

import json
import logging
import os
from datetime import date, datetime, timedelta

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


def transaction_unique_id(tx: dict, company_id: str, account_number: str) -> str:
    """Replicate moneyman's transactionUniqueId from src/bot/storage/utils.ts.

    Format: YYYY-MM-DD_companyId_accountNumber_chargedAmount_identifier
    where identifier = tx.identifier || (tx.description + "_" + tx.memo)
    Each part is str(p ?? "").strip(), joined with "_".
    """
    raw_date = tx.get("date", "")
    try:
        dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        date_str = dt.strftime("%Y-%m-%d")
    except (ValueError, AttributeError):
        date_str = str(raw_date).strip()

    identifier = tx.get("identifier") or (
        f"{tx.get('description', '')}_{tx.get('memo', '')}"
    )

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
    try:
        activity_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).date()
    except (ValueError, AttributeError):
        activity_date = raw_date

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
        "installments": (
            json.dumps(tx.get("installments")) if tx.get("installments") else None
        ),
        "raw": json.dumps(tx),
    }


def run_sync(credentials: list[dict], run_id: str, lookback_days: int) -> None:
    """Background task: scrape each account and upsert transactions."""
    if is_mock_mode():
        return

    start_date = (date.today() - timedelta(days=lookback_days)).isoformat()
    account_statuses: list[str] = []

    for credential in credentials:
        company_id = credential.get("companyId", "")
        account_title = credential.get("accountTitle", "")

        # account number comes from the first credential field that looks like card digits
        # or falls back to the title; the actual accountNumber is returned in the scraper response
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

        account_number = result.get("accountNumber", account_title)
        txns = result.get("transactions", [])
        try:
            rows = [_build_transaction_row(tx, company_id, account_number) for tx in txns]
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
    clear_all()
