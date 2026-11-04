"""Writes for equity grants (real-DB mode only).

Mock mode keeps grants in an in-memory store in ``backend/routers/equity.py``,
mirroring how the investments router handles its mock writes.
"""

from src.db.connection import execute_returning
from src.db.queries.equity import GRANT_COLUMNS


def insert_equity_grant(data: dict) -> dict:
    """Insert a grant and return the stored row."""
    df = execute_returning(
        f"""
        INSERT INTO equity_grants
            (name, grant_date, shares, strike, vesting_years, cliff_months)
        VALUES
            (:name, :grant_date, :shares, :strike, :vesting_years, :cliff_months)
        RETURNING {GRANT_COLUMNS}
        """,
        data,
    )
    return df.iloc[0].to_dict()


def update_equity_grant(grant_id: int, data: dict) -> dict | None:
    """Replace a grant's fields. Returns the stored row, or None if no such grant."""
    df = execute_returning(
        f"""
        UPDATE equity_grants SET
            name = :name,
            grant_date = :grant_date,
            shares = :shares,
            strike = :strike,
            vesting_years = :vesting_years,
            cliff_months = :cliff_months,
            updated_at = now()
        WHERE id = :id
        RETURNING {GRANT_COLUMNS}
        """,
        {**data, "id": grant_id},
    )
    return df.iloc[0].to_dict() if len(df) else None


def delete_equity_grant(grant_id: int) -> bool:
    """Delete a grant. Returns False if it didn't exist."""
    df = execute_returning(
        "DELETE FROM equity_grants WHERE id = :id RETURNING id",
        {"id": grant_id},
    )
    return len(df) > 0
