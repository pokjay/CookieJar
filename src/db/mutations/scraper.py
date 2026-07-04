"""DB mutations for scraper run tracking and transaction upserts."""

from sqlalchemy.exc import IntegrityError

from src.db.connection import (
    execute_mutation,
    execute_mutations_batch,
    execute_returning,
    is_mock_mode,
)


class RunAlreadyRunningError(Exception):
    """Raised when insert_run() loses the race against the DB's one-running-run guard."""


def insert_run(lookback_days: int) -> str:
    """Insert a new scraper_run row with status='running'. Returns the run UUID.

    has_running_run() is checked by the caller first as a fast, cheap pre-check,
    but that check and this insert are not atomic — a concurrent request can
    pass the check too. The DB's partial unique index (scraper_runs_one_running)
    is the authoritative guard: a losing insert raises IntegrityError here,
    which we translate to RunAlreadyRunningError for the router to map to 409.
    """
    if is_mock_mode():
        return "mock-run-id"
    try:
        df = execute_returning(
            """
            INSERT INTO scraper_runs (lookback_days, status)
            VALUES (:lookback_days, 'running')
            RETURNING id::text
            """,
            {"lookback_days": lookback_days},
        )
    except IntegrityError as exc:
        raise RunAlreadyRunningError("A sync is already running.") from exc
    return df["id"].iloc[0]


def insert_run_account(run_id: str, account: str, company_id: str) -> None:
    """Insert a per-account row for a run with status='pending'."""
    if is_mock_mode():
        return
    execute_mutation(
        """
        INSERT INTO scraper_run_accounts (run_id, account, company_id, status)
        VALUES (:run_id ::uuid, :account, :company_id, 'pending')
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
        WHERE run_id = :run_id ::uuid
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
        WHERE id = :run_id ::uuid
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


_UPSERT_TRANSACTION_SQL = """
    INSERT INTO transactions (
        unique_id, company_id, account, status,
        activity_date, charged_amount, charged_currency,
        original_amount, original_currency,
        description, memo, identifier, installments, raw,
        created_at, updated_at
    ) VALUES (
        :unique_id, :company_id, :account, :status,
        :activity_date, :charged_amount, :charged_currency,
        :original_amount, :original_currency,
        :description, :memo, :identifier, :installments ::jsonb, :raw ::jsonb,
        now(), now()
    )
    ON CONFLICT (unique_id) DO NOTHING
"""


def upsert_transactions(rows: list[dict]) -> int:
    """Upsert already-shaped transaction rows into moneyman.transactions.

    Each row must have unique_id, company_id, account, status, activity_date,
    charged_amount, charged_currency, original_amount, original_currency,
    description, memo, identifier, installments (JSON string or None), raw
    (JSON string). Mapping from the scraper's transaction shape to this row
    shape is the caller's responsibility (backend/scraper_sync.py), since it
    owns transaction_unique_id() and the moneyman-compatibility logic.

    Returns the number of rows actually inserted — rows skipped by
    ON CONFLICT DO NOTHING are not counted. All rows are written in a single
    DB transaction rather than one per row.
    """
    if is_mock_mode():
        return 0
    return execute_mutations_batch(_UPSERT_TRANSACTION_SQL, rows)
