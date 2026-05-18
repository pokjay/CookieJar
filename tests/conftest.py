"""Test configuration.

Integration tests require a real PostgreSQL instance. Set TEST_DATABASE_URL to opt in:

    TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/family_finance_test \\
        uv run pytest -m integration
"""

import os
from pathlib import Path

import pandas as pd
import pytest
from sqlalchemy import create_engine

MIGRATION_FILE = (
    Path(__file__).parent.parent / "db" / "migrations" / "20260417000000_initial_schema.sql"
)


# ---------------------------------------------------------------------------
# Integration test fixtures (require TEST_DATABASE_URL)
# ---------------------------------------------------------------------------


def _extract_up_sql(migration_path: Path) -> str:
    content = migration_path.read_text()
    return content.split("-- migrate:up")[1].split("-- migrate:down")[0].strip()


@pytest.fixture(scope="session")
def integration_engine():
    """SQLAlchemy engine pointing at the integration test database.

    Skips automatically if TEST_DATABASE_URL is not set.
    Point this at a dedicated test database, never at production.
    """
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set — skipping integration tests")
    return create_engine(url)


@pytest.fixture(scope="session")
def migrated_db(integration_engine):
    """Apply the baseline schema migration, clean-slate, for the test session."""
    up_sql = _extract_up_sql(MIGRATION_FILE)
    statements = [s.strip() for s in up_sql.split(";") if s.strip()]

    with integration_engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA IF EXISTS moneyman CASCADE")
        for stmt in statements:
            conn.exec_driver_sql(stmt)

    yield integration_engine

    with integration_engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA IF EXISTS moneyman CASCADE")


@pytest.fixture(scope="session")
def seeded_db(migrated_db):
    """Seed the integration database with mock data.

    Uses the same generators as mock mode so tests exercise real query behaviour
    without a separate fixture dataset.
    """
    from src.db.mock_data import (
        get_business_descriptions,
        get_business_mappings,
        get_cash_flow,
        get_description_to_category,
        get_investment_accounts,
        get_investment_tracking,
        get_transactions,
    )

    engine = migrated_db

    def _insert(df: pd.DataFrame, table: str) -> None:
        df.to_sql(table, engine, schema="moneyman", if_exists="append", index=False)

    # Mock transactions are a denormalised DataFrame (view-like). Strip columns that
    # don't exist on the base table and add the required `raw` jsonb column.
    transactions = get_transactions()[
        [
            "unique_id", "company_id", "account", "status", "activity_date",
            "charged_amount", "charged_currency", "original_amount",
            "original_currency", "description", "memo", "identifier",
        ]
    ].copy()
    transactions["raw"] = "{}"
    transactions["installments"] = None
    _insert(transactions, "transactions")

    _insert(get_description_to_category()[["description", "category", "subcategory"]], "description_to_category")
    _insert(get_business_descriptions()[["description"]], "business_descriptions")
    _insert(get_business_mappings(), "business_transaction_mappings")
    _insert(get_cash_flow(), "monthly_cash_flow")
    _insert(get_investment_accounts(), "investment_accounts")
    _insert(get_investment_tracking(), "investment_accounts_tracking")

    yield engine
