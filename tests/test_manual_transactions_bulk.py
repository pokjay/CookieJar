"""Integration tests for the manual transactions bulk-import endpoint.

These tests back the e2e flow added for issue #41 (per-row editing in the CSV
import preview). They verify that the backend persists each row's
`cash_flow_type` independently, which is the central case the UI now enables.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

pytestmark = pytest.mark.integration


@pytest.fixture
def bulk_endpoint(migrated_db, monkeypatch):
    """Return the `/api/manual-transactions/bulk` route handler, wired against
    the integration DB and called as a regular function.

    Using TestClient would require pulling in httpx purely for tests; calling
    the handler directly exercises the same Pydantic validation + DB path with
    no extra deps.
    """
    # render_as_string(hide_password=False) so psycopg2 actually receives the password —
    # str(engine.url) masks it as "***".
    url = migrated_db.url.render_as_string(hide_password=False)
    # Ensure the moneyman schema is on the search_path so unqualified
    # `transactions_manual` references in src/db/mutations/transactions.py resolve.
    if "options=" not in url:
        url = f"{url}?options=-csearch_path%3Dmoneyman"

    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("USE_MOCK_DATA", "false")

    # Reset the module-level cached engine so it picks up the test DATABASE_URL.
    # monkeypatch restores _engine to its original value on teardown — important so
    # later tests don't keep using an engine pointed at the integration DB.
    import src.db.connection as conn_mod
    monkeypatch.setattr(conn_mod, "_engine", None)

    from backend.routers.manual_transactions import BulkImportPayload, bulk_import

    def _call(rows: list[dict]) -> dict:
        return bulk_import(BulkImportPayload(rows=rows))

    return _call


def _bulk_payload(account: str) -> list[dict]:
    """3 rows that exercise different cash_flow_type values per row — the core of issue #41."""
    return [
        {
            "account": account,
            "activity_date": "2026-04-01",
            "charged_currency": "ILS",
            "original_amount": 5000.0,
            "original_currency": "ILS",
            "description": "Bulk-row salary",
            "cash_flow_type": "salary",
        },
        {
            "account": account,
            "activity_date": "2026-04-02",
            "charged_currency": "ILS",
            "original_amount": 45.5,
            "original_currency": "ILS",
            "description": "Bulk-row coffee",
            "cash_flow_type": "expense",
        },
        {
            "account": account,
            "activity_date": "2026-04-03",
            "charged_currency": "ILS",
            "original_amount": 1200.0,
            "original_currency": "ILS",
            "description": "Bulk-row savings",
            "cash_flow_type": "savings",
        },
    ]


def _fetch_rows(engine, account: str) -> list[dict]:
    sql = sa.text(
        """
        SELECT account, activity_date, original_amount,
               description, cash_flow_type::text AS cash_flow_type,
               show_in_transactions
        FROM moneyman.transactions_manual
        WHERE account = :account
        ORDER BY activity_date
        """
    )
    with engine.connect() as conn:
        return [dict(row._mapping) for row in conn.execute(sql, {"account": account}).fetchall()]


def test_bulk_import_persists_per_row_cash_flow_type(bulk_endpoint, migrated_db):
    """The endpoint must store each row's cash_flow_type as-given, not a single
    shared value. This is the regression guard for the issue #41 e2e flow."""
    account = "pytest-bulk-mixed-cft"
    result = bulk_endpoint(_bulk_payload(account))
    assert result == {"ok": True, "imported": 3}

    rows = _fetch_rows(migrated_db, account)
    assert len(rows) == 3
    by_desc = {r["description"]: r for r in rows}
    assert by_desc["Bulk-row salary"]["cash_flow_type"] == "salary"
    assert by_desc["Bulk-row coffee"]["cash_flow_type"] == "expense"
    assert by_desc["Bulk-row savings"]["cash_flow_type"] == "savings"


def test_bulk_import_defaults_invalid_cash_flow_type_to_expense(bulk_endpoint, migrated_db):
    """A bad enum value should fall back to 'expense', matching the router's contract."""
    account = "pytest-bulk-bad-cft"
    rows_in = [
        {
            "account": account,
            "activity_date": "2026-04-04",
            "charged_currency": "ILS",
            "original_amount": 99.0,
            "original_currency": "ILS",
            "description": "Bad type row",
            "cash_flow_type": "not_a_real_type",
        }
    ]
    bulk_endpoint(rows_in)

    rows = _fetch_rows(migrated_db, account)
    assert len(rows) == 1
    assert rows[0]["cash_flow_type"] == "expense"


def test_bulk_import_persists_per_row_show_in_transactions(bulk_endpoint, migrated_db):
    """Each row's show_in_transactions must be stored as given (issue #48)."""
    account = "pytest-bulk-show-in-tx"
    rows_in = [
        {
            "account": account,
            "activity_date": "2026-04-06",
            "charged_currency": "ILS",
            "original_amount": 10.0,
            "original_currency": "ILS",
            "description": "Visible row",
            "show_in_transactions": True,
        },
        {
            "account": account,
            "activity_date": "2026-04-07",
            "charged_currency": "ILS",
            "original_amount": 20.0,
            "original_currency": "ILS",
            "description": "Hidden row",
            "show_in_transactions": False,
        },
    ]
    bulk_endpoint(rows_in)

    rows = _fetch_rows(migrated_db, account)
    by_desc = {r["description"]: r for r in rows}
    assert by_desc["Visible row"]["show_in_transactions"] is True
    assert by_desc["Hidden row"]["show_in_transactions"] is False


def test_bulk_import_defaults_show_in_transactions_to_true(bulk_endpoint, migrated_db):
    """Omitting show_in_transactions should default to True (issue #48)."""
    account = "pytest-bulk-show-default"
    rows_in = [
        {
            "account": account,
            "activity_date": "2026-04-08",
            "charged_currency": "ILS",
            "original_amount": 30.0,
            "original_currency": "ILS",
            "description": "Default visibility row",
        }
    ]
    bulk_endpoint(rows_in)

    rows = _fetch_rows(migrated_db, account)
    assert len(rows) == 1
    assert rows[0]["show_in_transactions"] is True


def test_bulk_import_charged_amount_falls_back_to_original_amount(bulk_endpoint, migrated_db):
    """When charged_amount is omitted, the row should land using original_amount.

    Matches the UI behaviour where charged_amount is read-only in the preview
    because the backend fills it in.
    """
    account = "pytest-bulk-charged-default"
    rows_in = [
        {
            "account": account,
            "activity_date": "2026-04-05",
            "charged_currency": "ILS",
            "original_amount": 250.0,
            "original_currency": "ILS",
            "description": "Default charged amount",
            "cash_flow_type": "expense",
        }
    ]
    bulk_endpoint(rows_in)

    with migrated_db.connect() as conn:
        result = conn.execute(
            sa.text(
                "SELECT charged_amount, original_amount "
                "FROM moneyman.transactions_manual WHERE account = :account"
            ),
            {"account": account},
        ).one()
    assert float(result.charged_amount) == 250.0
    assert float(result.original_amount) == 250.0
