"""DB mutations for scraper run tracking and transaction upserts."""

from sqlalchemy.exc import IntegrityError

from src.db.connection import (
    execute_mutation,
    execute_returning,
    execute_upserts_batch,
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
    error_message: str | None = None,
    enrichment_added: int | None = None,
    enrichment_missing: int | None = None,
) -> None:
    """Update the per-account row with final status.

    error_message is the scraper's own human-readable explanation, not the
    provider's error text — see describeFailure() in scraper/src/app.js.

    enrichment_added / enrichment_missing describe the bank-category pass, which
    is budgeted and can stop before it has covered everything. Both stay None
    when enrichment did not apply to this account — the caller did not ask for
    it, or the provider has no such pass — so those accounts show no counter
    rather than one stuck above zero forever.
    """
    if is_mock_mode():
        return
    execute_mutation(
        """
        UPDATE scraper_run_accounts
        SET status = :status,
            error_type = :error_type,
            error_message = :error_message,
            transactions_imported = :transactions_imported,
            enrichment_added = :enrichment_added,
            enrichment_missing = :enrichment_missing
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
            "error_message": error_message,
            "transactions_imported": transactions_imported,
            "enrichment_added": enrichment_added,
            "enrichment_missing": enrichment_missing,
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


# unique_id is derived from date/company/account/amount/identifier - never from
# raw, memo or bank_category. So a transaction we already stored keeps whatever
# we first learned about it unless this statement refreshes it, which is why
# enrichment collected on a later run has to arrive through the conflict path
# (#135).
#
# The trap that shapes this clause: a sync with enrichment off, or one whose
# enrichment budget ran out, produces a transaction with NO category. A plain
# `SET raw = EXCLUDED.raw` would then ERASE enrichment that an earlier, more
# expensive run had already paid for - and since enrichment converges over
# several runs, that would mean it never converges at all. So:
#
#   * bank_category only ever moves from NULL to a value, never back;
#   * raw is replaced only when the incoming copy is at least as enriched as the
#     stored one - either it carries a REAL category, or the stored row never
#     had one. Note NULLIF: an empty answer is not "enriched" for this purpose,
#     so it must not pull raw backwards either. Both rules read the incoming
#     category through the same NULLIF so they can never disagree about what
#     counts as enriched.
#
# Three-valued, not two: NULL means "never asked", '' means "asked, and the
# provider has no category for this one" (see _bank_category in
# backend/scraper_sync.py). Recording that empty answer is what lets the backlog
# reach zero instead of re-asking the same hopeless question every sync. But ''
# must never displace a real category, so it wins only on a row that has none -
# hence NULLIF ... COALESCE ... EXCLUDED rather than a plain COALESCE.
_UPSERT_TRANSACTION_SQL = """
    INSERT INTO transactions (
        unique_id, company_id, account, status,
        activity_date, charged_amount, charged_currency,
        original_amount, original_currency,
        description, memo, identifier, installments, raw, bank_category,
        created_at, updated_at
    ) VALUES (
        :unique_id, :company_id, :account, :status,
        :activity_date, :charged_amount, :charged_currency,
        :original_amount, :original_currency,
        :description, :memo, :identifier, :installments ::jsonb, :raw ::jsonb,
        :bank_category,
        now(), now()
    )
    ON CONFLICT (unique_id) DO UPDATE SET
        raw = CASE
                WHEN NULLIF(EXCLUDED.bank_category, '') IS NOT NULL
                  OR transactions.bank_category IS NULL
                THEN EXCLUDED.raw
                ELSE transactions.raw
              END,
        memo = EXCLUDED.memo,
        bank_category = COALESCE(
            NULLIF(EXCLUDED.bank_category, ''), transactions.bank_category, EXCLUDED.bank_category
        ),
        updated_at = now()
    WHERE transactions.memo IS DISTINCT FROM EXCLUDED.memo
       OR transactions.bank_category IS DISTINCT FROM COALESCE(
            NULLIF(EXCLUDED.bank_category, ''), transactions.bank_category, EXCLUDED.bank_category
          )
       OR (transactions.raw IS DISTINCT FROM EXCLUDED.raw
           AND (NULLIF(EXCLUDED.bank_category, '') IS NOT NULL
                OR transactions.bank_category IS NULL))
    RETURNING (xmax = 0) AS inserted
"""


def upsert_transactions(rows: list[dict]) -> tuple[int, int]:
    """Upsert already-shaped transaction rows into moneyman.transactions.

    Each row must have unique_id, company_id, account, status, activity_date,
    charged_amount, charged_currency, original_amount, original_currency,
    description, memo, identifier, installments (JSON string or None), raw
    (JSON string) and bank_category (str or None). Mapping from the scraper's
    transaction shape to this row shape is the caller's responsibility
    (backend/scraper_sync.py), since it owns transaction_unique_id() and the
    moneyman-compatibility logic.

    Returns (inserted, updated). Callers report `inserted` as the run's
    "transactions imported" - it kept that meaning across the move from
    DO NOTHING to DO UPDATE, which is the whole reason this counts the two
    separately. A re-scrape that changes nothing is neither: the WHERE guard
    above rejects it, so updated_at stays put and the 5-minute cache is not
    dirtied for nothing.

    All rows are written in a single DB transaction rather than one per row.
    """
    if is_mock_mode():
        return (0, 0)
    return execute_upserts_batch(_UPSERT_TRANSACTION_SQL, rows)
