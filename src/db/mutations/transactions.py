import uuid

from src.db.connection import execute_mutation, is_mock_mode

_mock_state: dict = {}


def _ensure_unique_id(row: dict) -> dict:
    """Return row with unique_id set (auto-generate UUID if blank)."""
    row = dict(row)
    if not row.get("unique_id"):
        row["unique_id"] = str(uuid.uuid4())
    return row


def insert_manual_transaction(row: dict) -> None:
    """Insert one row into transactions_manual."""
    row = _ensure_unique_id(row)

    if is_mock_mode():
        if "mock_manual_transactions" not in _mock_state:
            _mock_state["mock_manual_transactions"] = []
        existing = _mock_state["mock_manual_transactions"]
        for existing_row in existing:
            if (
                existing_row.get("activity_date") == row.get("activity_date")
                and existing_row.get("account") == row.get("account")
                and existing_row.get("charged_amount") == row.get("charged_amount")
                and existing_row.get("description") == row.get("description")
            ):
                existing_row["updated_at"] = "now"
                return
        existing.append(row)
        return

    # Upsert: update updated_at if a matching row already exists in transactions_manual
    # (match on activity_date + account + charged_amount + description), otherwise insert.
    # Duplicate detection in the UI checks the full combined view (incl. moneyman data).
    execute_mutation(
        """
        WITH updated AS (
            UPDATE transactions_manual
            SET updated_at = now()
            WHERE activity_date = :activity_date
              AND account = :account
              AND charged_amount = :charged_amount
              AND description = :description
            RETURNING unique_id
        )
        INSERT INTO transactions_manual (
            unique_id, account, activity_date, charged_amount, charged_currency,
            original_amount, original_currency, description, identifier,
            additional_info, charged_date, cash_flow_type, show_in_transactions,
            created_at, updated_at
        )
        SELECT
            :unique_id, :account, :activity_date, :charged_amount, :charged_currency,
            :original_amount, :original_currency, :description, :identifier,
            :additional_info, :charged_date, :cash_flow_type, :show_in_transactions,
            now(), now()
        WHERE NOT EXISTS (SELECT 1 FROM updated)
        """,
        row,
    )


def insert_manual_transactions(rows: list[dict]) -> None:
    """Bulk insert rows into transactions_manual."""
    for row in rows:
        insert_manual_transaction(row)
