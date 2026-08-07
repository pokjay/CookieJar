"""Test configuration.

Integration tests require a real PostgreSQL instance. Set TEST_DATABASE_URL to opt in:

    TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/family_finance_test \\
        uv run pytest -m integration
"""

import os

# SAFETY: force mock mode for the whole test session *before* any test module is
# imported. Importing src.db.connection runs load_dotenv(), which would otherwise
# pull USE_MOCK_DATA=false + the real DATABASE_URL from .env — and the per-file
# `os.environ.setdefault(...)` guards are no-ops once that's happened (import
# order dependent). Without this, a router write-test can hit the production DB.
# Integration tests opt back in explicitly via monkeypatch.setenv (see
# test_manual_transactions_bulk.py), which overrides these for the test's scope.
os.environ["USE_MOCK_DATA"] = "true"
# Defense in depth: blank the default DB URL so that even if a test flips mock
# mode off without pointing at a test DB, _get_engine() fails loudly instead of
# silently connecting to whatever .env configured.
os.environ["DATABASE_URL"] = ""

from pathlib import Path  # noqa: E402

import pandas as pd  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402


@pytest.fixture(autouse=True)
def _enforce_mock_mode(request):
    """Fail any non-integration test that isn't in mock mode.

    Belt-and-suspenders with the env force above: if a future change lets a unit
    or router test reach a real database, this trips at setup with a clear message
    instead of silently reading or *writing* production data.
    """
    if "integration" in request.keywords:
        return
    from src.db.connection import is_mock_mode

    assert is_mock_mode(), (
        "Non-integration tests must run in mock mode (USE_MOCK_DATA != 'false'). "
        "Mark DB tests with @pytest.mark.integration and point them at TEST_DATABASE_URL."
    )


MIGRATIONS_DIR = Path(__file__).parent.parent / "db" / "migrations"


# ---------------------------------------------------------------------------
# Integration test fixtures (require TEST_DATABASE_URL)
# ---------------------------------------------------------------------------


def _extract_up_sql(migration_path: Path) -> str:
    content = migration_path.read_text()
    return content.split("-- migrate:up")[1].split("-- migrate:down")[0].strip()


def _split_statements(sql: str) -> list[str]:
    """Split a migration's SQL into statements on semicolons that actually
    terminate one.

    A plain sql.split(";") is wrong, and silently so: a semicolon inside a `--`
    comment or a quoted literal cuts the statement in half, and the leading
    fragment is often still valid SQL, so the failure surfaces far from its
    cause. 20260731000000_expose_cash_flow_type.sql has exactly that -
    "cash_flow_type is an enum; the scraped branch..." inside a CREATE VIEW -
    which truncated the view at the comment and errored with "syntax error at
    end of input", taking every integration test in the suite down with it.

    Comments are stripped rather than preserved: only the executable SQL matters
    here, and dropping them removes the whole class of problem. Handles `--`
    line comments and single-quoted literals, which is everything these
    migrations use (no dollar-quoted bodies - see db/migrations/).
    """
    statements: list[str] = []
    current: list[str] = []
    in_string = False
    i = 0
    while i < len(sql):
        char = sql[i]
        if in_string:
            current.append(char)
            # '' is an escaped quote inside a literal, not the end of one.
            if char == "'":
                if sql[i + 1 : i + 2] == "'":
                    current.append("'")
                    i += 1
                else:
                    in_string = False
        elif char == "'":
            in_string = True
            current.append(char)
        elif sql.startswith("--", i):
            i = sql.find("\n", i)
            if i == -1:
                break
            current.append("\n")
        elif char == ";":
            statements.append("".join(current))
            current = []
        else:
            current.append(char)
        i += 1
    statements.append("".join(current))
    return [s.strip() for s in statements if s.strip()]


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
    """Apply every migration in db/migrations/, in order, clean-slate, for the
    test session — not just the first one, so later tables (app_settings,
    scraper_runs, ...) actually exist for tests that need them."""
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

    with integration_engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA IF EXISTS moneyman CASCADE")
        for migration_file in migration_files:
            for stmt in _split_statements(_extract_up_sql(migration_file)):
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
            "unique_id",
            "company_id",
            "account",
            "status",
            "activity_date",
            "charged_amount",
            "charged_currency",
            "original_amount",
            "original_currency",
            "description",
            "memo",
            "identifier",
        ]
    ].copy()
    transactions["raw"] = "{}"
    transactions["installments"] = None
    _insert(transactions, "transactions")

    _insert(
        get_description_to_category()[["description", "category", "subcategory"]],
        "description_to_category",
    )
    _insert(get_business_descriptions()[["description"]], "business_descriptions")
    _insert(get_business_mappings(), "business_transaction_mappings")
    _insert(get_cash_flow(), "monthly_cash_flow")
    _insert(get_investment_accounts(), "investment_accounts")
    _insert(get_investment_tracking(), "investment_accounts_tracking")

    yield engine
