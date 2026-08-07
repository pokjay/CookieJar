"""DB queries for scraper run history."""

import pandas as pd

from src.db.connection import is_mock_mode, run_query


def get_last_run() -> dict | None:
    """Return the most recent scraper run with per-account detail, or None."""
    if is_mock_mode():
        return None
    df = run_query(
        """
        SELECT
            r.id::text AS id,
            r.status,
            r.lookback_days,
            r.started_at,
            r.finished_at
        FROM scraper_runs r
        ORDER BY r.started_at DESC
        LIMIT 1
        """,
    )
    if df.empty:
        return None

    row = df.iloc[0]
    run_id = row["id"]

    accounts_df = run_query(
        """
        SELECT account, company_id, status, error_type, error_message,
               transactions_imported, enrichment_added, enrichment_missing
        FROM scraper_run_accounts
        WHERE run_id = :run_id ::uuid
        ORDER BY company_id, account
        """,
        {"run_id": run_id},
    )

    accounts = [
        {
            "account": r["account"],
            "company_id": r["company_id"],
            "status": r["status"],
            "error_type": r["error_type"],
            # pandas turns a SQL NULL in a text column into NaN, which is not
            # JSON-serialisable and would surface as the string "nan" downstream.
            "error_message": r["error_message"] if pd.notna(r["error_message"]) else None,
            "transactions_imported": int(r["transactions_imported"]),
            # NULL here means enrichment did not apply to this account at all,
            # which the UI renders as "no counter" rather than as zero — those
            # are different statements and only one of them is true for max.
            "enrichment_added": (
                int(r["enrichment_added"]) if pd.notna(r["enrichment_added"]) else None
            ),
            "enrichment_missing": (
                int(r["enrichment_missing"]) if pd.notna(r["enrichment_missing"]) else None
            ),
        }
        for _, r in accounts_df.iterrows()
    ]

    return {
        "id": run_id,
        "status": row["status"],
        "lookback_days": int(row["lookback_days"]),
        "started_at": row["started_at"].isoformat() if row["started_at"] is not None else None,
        "finished_at": row["finished_at"].isoformat() if row["finished_at"] is not None else None,
        "accounts": accounts,
    }


def has_running_run() -> bool:
    """Return True if there is currently a 'running' sync."""
    if is_mock_mode():
        return False
    df = run_query(
        "SELECT 1 FROM scraper_runs WHERE status = 'running' LIMIT 1"
    )
    return not df.empty


def enriched_identifiers(company_id: str, start_date: str) -> list[str]:
    """Transaction identifiers in this window that already carry a bank category.

    This is the scraper sidecar's skip set: one PirteyIska_204 request per entry
    is a request it does not have to make (see scraper/src/enrichment.js). It
    lists what IS enriched rather than what is missing on purpose - a
    transaction the provider has but we have never seen is in neither list, and
    must be fetched, not assumed done.

    Keyed on identifier alone, not (account, identifier): the enrichment URL
    carries CardIndex, a per-login ordinal with no path back to the account
    number stored here. Two cards under one login sharing an identifier would
    therefore cost one transaction its category - acceptable for data that is
    explicitly secondary to the transactions themselves.
    """
    if is_mock_mode():
        return []
    df = run_query(
        """
        SELECT DISTINCT identifier
        FROM transactions
        WHERE company_id = :company_id
          AND activity_date >= :start_date ::date
          AND bank_category IS NOT NULL
          AND identifier IS NOT NULL
        """,
        {"company_id": company_id, "start_date": start_date},
    )
    if df.empty:
        return []
    return [str(v).strip() for v in df["identifier"].tolist()]


def pending_enrichment_count(unique_ids: list[str]) -> int:
    """How many of the transactions THIS SCRAPE returned still have no category.

    Scoped to the scrape's own output rather than to the lookback window, because
    the two do not agree at the edges and the difference is not cosmetic: a
    window-scoped count includes rows stored by an older sync that the provider
    has since stopped returning, and nothing can ever enrich those. Observed
    live - four amex rows dated 2026-06-28 sat exactly on a 40-day boundary
    whose scrape started at 2026-06-29, so every re-run reported "4 missing",
    asked about none of them, and the number never moved.

    Counting only what the scrape actually returned makes the figure mean what
    the UI claims it means: how much a re-run over the same window could still
    fix. Rows the provider has dropped fall out on their own.
    """
    if is_mock_mode() or not unique_ids:
        return 0
    df = run_query(
        """
        SELECT count(*) AS pending
        FROM transactions
        WHERE unique_id = ANY(:unique_ids)
          AND bank_category IS NULL
        """,
        {"unique_ids": list(unique_ids)},
    )
    return int(df["pending"].iloc[0]) if not df.empty else 0
