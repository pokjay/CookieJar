import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_transactions


def get_existing_transaction_keys() -> set[tuple]:
    """Return a set of (activity_date, account, charged_amount, description)
    tuples for duplicate detection."""
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

    df = run_query(
        "SELECT DISTINCT account FROM processed_transcations_with_categories ORDER BY account"
    )
    return df["account"].tolist()


# Sign each manual cash_flow_type carries under the app's convention, where a
# positive charged_amount means money spent. savings and internal_transfer are
# deliberately absent: they are neither spend nor income, so their amount is
# left as recorded and callers filter them out by cash_flow_type instead.
_INTENT_SIGN = {"expense": 1, "salary": -1, "other_income": -1}

#: cash_flow_type values whose sign is derived from intent by
#: :func:`normalize_manual_signs`, and which must therefore not also be flipped
#: by the per-account ``sign_flipped_accounts`` rule.
NORMALIZED_INTENTS = frozenset(_INTENT_SIGN)


def normalize_manual_signs(df: pd.DataFrame) -> pd.DataFrame:
    """Give manually-imported rows a sign that matches what they mean.

    Manual rows keep whatever sign the source bank exported — the bank accounts
    write expenses negative, the card accounts write them positive — and the
    view negates them a second time on the way out. Sign alone therefore cannot
    say whether a manual row is spend, which silently dropped bank-paid
    expenses (rent, daycare) from anything filtering on ``charged_amount > 0``.

    ``cash_flow_type`` is the intent recorded at import, so use it: expenses
    come out positive, income negative. Scraped rows have no intent recorded
    and are left to the per-account ``sign_flipped_accounts`` rule.
    """
    if "cash_flow_type" not in df.columns:
        return df

    df = df.copy()
    for intent, sign in _INTENT_SIGN.items():
        rows = df["cash_flow_type"] == intent
        df.loc[rows, "charged_amount"] = sign * df.loc[rows, "charged_amount"].abs()
    return df


def get_all_transactions() -> pd.DataFrame:
    """Get all processed transactions with categories."""
    if is_mock_mode():
        return get_transactions()

    return normalize_manual_signs(
        run_query("""
            SELECT * FROM processed_transcations_with_categories
            ORDER BY activity_date DESC
        """)
    )


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
