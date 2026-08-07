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


def execute_returning(sql: str, params: dict | None = None) -> pd.DataFrame:
    """Run a write statement with a RETURNING clause and commit it.

    Unlike run_query (a plain engine.connect(), meant for read-only SELECTs),
    this wraps engine.begin() so the write is actually committed. Uses
    conn.execute() directly rather than pd.read_sql: pandas wraps any
    DB-level error (e.g. a unique-constraint violation) in
    pandas.errors.DatabaseError, hiding the underlying SQLAlchemy exception
    (e.g. IntegrityError) that callers need to catch specifically.
    """
    engine = _get_engine()
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return pd.DataFrame(result.mappings().all())


def execute_mutations_batch(sql: str, params_list: list[dict]) -> int:
    """Run the same RETURNING statement for many param sets in one transaction.

    Returns the number of rows actually returned/affected (e.g. real inserts
    when the statement uses ON CONFLICT ... DO NOTHING RETURNING ...).
    """
    if not params_list:
        return 0
    engine = _get_engine()
    total = 0
    with engine.begin() as conn:
        for params in params_list:
            result = conn.execute(text(sql), params)
            total += result.rowcount
    return total


def execute_upserts_batch(sql: str, params_list: list[dict]) -> tuple[int, int]:
    """Run an upsert for many param sets in one transaction, counting inserts
    and updates separately. Returns (inserted, updated).

    execute_mutations_batch's rowcount cannot tell the two apart: under
    ON CONFLICT ... DO UPDATE an update reports rowcount 1 exactly as an insert
    does, so a re-scrape of rows we already had would inflate the "imported"
    figure the sync reports. The statement must therefore end with

        RETURNING (xmax = 0) AS inserted

    - xmax is zero on a freshly inserted tuple and non-zero on one produced by
    the conflict path. A statement whose DO UPDATE carries a WHERE guard returns
    no row at all when the guard rejects it, which is how a genuine no-op
    re-scrape counts as neither.
    """
    if not params_list:
        return (0, 0)
    engine = _get_engine()
    inserted = 0
    updated = 0
    with engine.begin() as conn:
        for params in params_list:
            for row in conn.execute(text(sql), params):
                if row.inserted:
                    inserted += 1
                else:
                    updated += 1
    return (inserted, updated)


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
