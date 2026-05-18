import os

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

_engine = None


def is_mock_mode() -> bool:
    return os.getenv("USE_MOCK_DATA", "true").lower() != "false"


def _get_engine():
    global _engine
    if _engine is None:
        url = os.getenv("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL not set. Set it in .env or switch to mock mode.")
        _engine = create_engine(url)
    return _engine


def run_query(sql: str, params: dict | None = None) -> pd.DataFrame:
    engine = _get_engine()
    with engine.connect() as conn:
        return pd.read_sql(text(sql), conn, params=params, parse_dates=['activity_date'])


def execute_mutation(sql: str, params: dict | None = None) -> None:
    engine = _get_engine()
    with engine.begin() as conn:
        conn.execute(text(sql), params or {})


def get_enum_values(enum_name: str) -> list[str]:
    """Get the allowed values for a PostgreSQL enum type."""
    engine = _get_engine()
    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT e.enumlabel FROM pg_enum e "
            "JOIN pg_type t ON e.enumtypid = t.oid "
            "WHERE t.typname = :name ORDER BY e.enumsortorder"
        ), {"name": enum_name})
        return [row[0] for row in result]
