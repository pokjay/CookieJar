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
        SELECT account, company_id, status, error_type, error_message, transactions_imported
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
