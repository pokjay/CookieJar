import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_transactions


def get_existing_transaction_keys() -> set[tuple]:
    """Return a set of (activity_date, account, charged_amount, description) tuples for duplicate detection."""
    if is_mock_mode():
        df = get_transactions()
        return set(
            zip(
                df["activity_date"].dt.date,
                df["account"],
                df["charged_amount"],
                df["description"],
            )
        )

    df = run_query("""
        SELECT activity_date, account, charged_amount, description
        FROM transactions
        UNION
        SELECT activity_date, account, charged_amount, description
        FROM transactions_manual
    """)
    return set(
        zip(
            pd.to_datetime(df["activity_date"]).dt.date,
            df["account"],
            df["charged_amount"],
            df["description"],
        )
    )


def get_distinct_accounts() -> list[str]:
    """Get all distinct account names from processed_transcations_with_categories."""
    if is_mock_mode():
        return sorted(get_transactions()["account"].unique().tolist())

    df = run_query("SELECT DISTINCT account FROM processed_transcations_with_categories ORDER BY account")
    return df["account"].tolist()


def get_all_transactions() -> pd.DataFrame:
    """Get all processed transactions with categories."""
    if is_mock_mode():
        return get_transactions()

    return run_query("""
        SELECT * FROM processed_transcations_with_categories
        ORDER BY activity_date DESC
    """)


def get_transactions_excluding_travel() -> pd.DataFrame:
    """Get transactions excluding Travel category (keeps uncategorized)."""
    df = get_all_transactions()
    return df[(df["category"] != "Travel") | df["category"].isna()]


def get_travel_transactions() -> pd.DataFrame:
    """Get only Travel category transactions."""
    df = get_all_transactions()
    return df[df["category"] == "Travel"]


def get_uncategorized_transactions() -> pd.DataFrame:
    """Get transactions with no category assigned."""
    df = get_all_transactions()
    return df[df["category"].isna()]


def get_uncategorized_descriptions() -> pd.DataFrame:
    """Get unique processed descriptions that have no category mapping."""
    df = get_uncategorized_transactions()
    return (
        df.groupby("processed_description")
        .agg(
            count=("unique_id", "count"),
            total_amount=("charged_amount", "sum"),
            account=("account", "first"),
            last_date=("activity_date", "max"),
        )
        .reset_index()
        .sort_values(["count", "last_date"], ascending=[False, False])
    )
