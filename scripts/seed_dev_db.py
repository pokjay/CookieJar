"""Seed a local dev database with mock data.

Applies all migrations via dbmate, then inserts the same mock data used in mock
mode so the app can run against a real Postgres instance.

Usage:
    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/family_finance \
        uv run python scripts/seed_dev_db.py
"""

import os
import subprocess
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import JSONB

sys.path.insert(0, str(Path(__file__).parent.parent))

MIGRATIONS_DIR = Path(__file__).parent.parent / "db" / "migrations"


def _apply_migrations(url: str) -> None:
    result = subprocess.run(
        ["dbmate", "--url", url, "--migrations-dir", str(MIGRATIONS_DIR), "up"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Migration failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    if result.stdout.strip():
        print(result.stdout)


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)

    _apply_migrations(url)

    engine = create_engine(url)
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM moneyman.transactions")).scalar()
    if count > 0:
        print("Already seeded, skipping data insertion.")
        return

    print("Seeding mock data...")
    from src.db.mock_data import (
        get_business_descriptions,
        get_business_mappings,
        get_cash_flow,
        get_description_to_category,
        get_investment_accounts,
        get_investment_tracking,
        get_transactions,
    )

    with engine.begin() as conn:

        def _insert(df: pd.DataFrame, table: str, dtype=None) -> None:
            df.to_sql(table, conn, schema="moneyman", if_exists="append", index=False, dtype=dtype)
            print(f"  {table}: {len(df)} rows")

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
        transactions["raw"] = [{}] * len(transactions)
        transactions["installments"] = None
        _insert(transactions, "transactions", dtype={"raw": JSONB(), "installments": JSONB()})

        desc_to_cat = get_description_to_category()[["description", "category", "subcategory"]]
        _insert(desc_to_cat, "description_to_category")
        _insert(get_business_descriptions()[["description"]], "business_descriptions")
        _insert(get_business_mappings(), "business_transaction_mappings")

        cash_flow = get_cash_flow().drop(
            columns=["income_expense_diff", "savings_percentage"], errors="ignore"
        )
        _insert(cash_flow, "monthly_cash_flow")

        _insert(get_investment_accounts(), "investment_accounts")
        _insert(get_investment_tracking(), "investment_accounts_tracking")

    # Reset sequences to avoid PK conflicts on future inserts
    with engine.begin() as conn:
        conn.execute(
            text(
                "SELECT setval('moneyman.investment_accounts_id_seq', "
                "(SELECT MAX(id) FROM moneyman.investment_accounts))"
            )
        )
        conn.execute(
            text(
                "SELECT setval('moneyman.investment_accounts_tracking_id_seq', "
                "(SELECT MAX(id) FROM moneyman.investment_accounts_tracking))"
            )
        )
    print("  Sequences reset.")

    print("Done. Set USE_MOCK_DATA=false and run the app.")


if __name__ == "__main__":
    main()
