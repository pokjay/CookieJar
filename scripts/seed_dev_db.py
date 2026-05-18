"""Seed a local dev database with mock data.

Applies the baseline migration (drops and recreates the moneyman schema),
then inserts the same mock data used in mock mode so the app can run against
a real Postgres instance.

Usage:
    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/family_finance \
        uv run python scripts/seed_dev_db.py
"""

import os
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import JSONB

sys.path.insert(0, str(Path(__file__).parent.parent))

MIGRATION_FILE = Path(__file__).parent.parent / "db" / "migrations" / "20260417000000_initial_schema.sql"


def _extract_up_sql(path: Path) -> str:
    content = path.read_text()
    return content.split("-- migrate:up")[1].split("-- migrate:down")[0].strip()


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)

    engine = create_engine(url)

    with engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'moneyman'")
        ).fetchone()
    if exists:
        print("Schema 'moneyman' already exists — skipping seed (already done).")
        return

    print("Applying migration and seeding mock data...")
    from src.db.mock_data import (
        get_business_descriptions,
        get_business_mappings,
        get_cash_flow,
        get_description_to_category,
        get_investment_accounts,
        get_investment_tracking,
        get_transactions,
    )

    up_sql = _extract_up_sql(MIGRATION_FILE)
    statements = [s.strip() for s in up_sql.split(";") if s.strip()]

    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        print("  Schema created.")

        def _insert(df: pd.DataFrame, table: str, dtype=None) -> None:
            df.to_sql(table, conn, schema="moneyman", if_exists="append", index=False, dtype=dtype)
            print(f"  {table}: {len(df)} rows")

        transactions = get_transactions()[
            [
                "unique_id", "company_id", "account", "status", "activity_date",
                "charged_amount", "charged_currency", "original_amount",
                "original_currency", "description", "memo", "identifier",
            ]
        ].copy()
        transactions["raw"] = [{}] * len(transactions)
        transactions["installments"] = None
        _insert(transactions, "transactions", dtype={"raw": JSONB(), "installments": JSONB()})

        _insert(get_description_to_category()[["description", "category", "subcategory"]], "description_to_category")
        _insert(get_business_descriptions()[["description"]], "business_descriptions")
        _insert(get_business_mappings(), "business_transaction_mappings")

        cash_flow = get_cash_flow().drop(columns=["income_expense_diff", "savings_percentage"], errors="ignore")
        _insert(cash_flow, "monthly_cash_flow")

        _insert(get_investment_accounts(), "investment_accounts")
        _insert(get_investment_tracking(), "investment_accounts_tracking")

    # Reset sequences to avoid PK conflicts on future inserts
    with engine.begin() as conn:
        conn.execute(text(
            "SELECT setval('moneyman.investment_accounts_id_seq', "
            "(SELECT MAX(id) FROM moneyman.investment_accounts))"
        ))
        conn.execute(text(
            "SELECT setval('moneyman.investment_accounts_tracking_id_seq', "
            "(SELECT MAX(id) FROM moneyman.investment_accounts_tracking))"
        ))
    print("  Sequences reset.")

    print("Done. Set USE_MOCK_DATA=false and run the app.")


if __name__ == "__main__":
    main()
