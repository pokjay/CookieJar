"""DB mutations for scraper run tracking."""

from src.db.connection import execute_mutation, is_mock_mode, run_query


def insert_run(lookback_days: int) -> str:
    """Insert a new scraper_run row with status='running'. Returns the run UUID."""
    if is_mock_mode():
        return "mock-run-id"
    df = run_query(
        """
        INSERT INTO scraper_runs (lookback_days, status)
        VALUES (:lookback_days, 'running')
        RETURNING id::text
        """,
        {"lookback_days": lookback_days},
    )
    return df["id"].iloc[0]


def insert_run_account(run_id: str, account: str, company_id: str) -> None:
    """Insert a per-account row for a run with status='pending'."""
    if is_mock_mode():
        return
    execute_mutation(
        """
        INSERT INTO scraper_run_accounts (run_id, account, company_id, status)
        VALUES (:run_id::uuid, :account, :company_id, 'pending')
        """,
        {"run_id": run_id, "account": account, "company_id": company_id},
    )


def finish_run_account(
    run_id: str,
    account: str,
    company_id: str,
    status: str,
    error_type: str | None,
    transactions_imported: int,
) -> None:
    """Update the per-account row with final status."""
    if is_mock_mode():
        return
    execute_mutation(
        """
        UPDATE scraper_run_accounts
        SET status = :status,
            error_type = :error_type,
            transactions_imported = :transactions_imported
        WHERE run_id = :run_id::uuid
          AND account = :account
          AND company_id = :company_id
        """,
        {
            "run_id": run_id,
            "account": account,
            "company_id": company_id,
            "status": status,
            "error_type": error_type,
            "transactions_imported": transactions_imported,
        },
    )


def finish_run(run_id: str, status: str) -> None:
    """Mark the parent run as finished."""
    if is_mock_mode():
        return
    execute_mutation(
        """
        UPDATE scraper_runs
        SET status = :status, finished_at = now()
        WHERE id = :run_id::uuid
        """,
        {"run_id": run_id, "status": status},
    )


def mark_stale_runs() -> None:
    """Mark any 'running' runs older than 15 minutes as 'error' (crash recovery)."""
    if is_mock_mode():
        return
    execute_mutation(
        """
        UPDATE scraper_runs
        SET status = 'error', finished_at = now()
        WHERE status = 'running'
          AND started_at < now() - INTERVAL '15 minutes'
        """,
        {},
    )
