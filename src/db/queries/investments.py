import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_investment_accounts, get_investment_tracking


def get_distinct_persons() -> list[str]:
    """Get distinct person names from investment accounts."""
    if is_mock_mode():
        accounts = get_investment_accounts()
        return sorted(accounts["person"].unique().tolist())

    df = run_query("SELECT DISTINCT person FROM investment_accounts ORDER BY person")
    return df["person"].tolist()


def get_investment_accounts_with_latest() -> pd.DataFrame:
    """Get investment accounts joined with their latest tracking values."""
    if is_mock_mode():
        accounts = get_investment_accounts()
        tracking = get_investment_tracking()
        latest = (
            tracking.sort_values("activity_date")
            .groupby("investment_accounts_id")
            .last()
            .reset_index()[["investment_accounts_id", "amount", "activity_date"]]
        )
        merged = accounts.merge(
            latest,
            left_on="id",
            right_on="investment_accounts_id",
            how="left",
        )
        merged["latest_amount"] = merged["amount"].fillna(0)
        merged["latest_date"] = merged["activity_date"]
        return merged.drop(columns=["amount", "activity_date", "investment_accounts_id"])

    return run_query("""
        SELECT a.*, t.amount AS latest_amount, t.activity_date AS latest_date
        FROM investment_accounts a
        LEFT JOIN LATERAL (
            SELECT amount, activity_date
            FROM investment_accounts_tracking
            WHERE investment_accounts_id = a.id AND a.is_active = TRUE
            ORDER BY activity_date DESC
            LIMIT 1
        ) t ON TRUE
    """)


def get_net_worth_over_time() -> pd.DataFrame:
    """Get total net worth per quarter per person."""
    if is_mock_mode():
        accounts = get_investment_accounts()
        tracking = get_investment_tracking()
        merged = tracking.merge(
            accounts[["id", "person", "account_type_category"]],
            left_on="investment_accounts_id",
            right_on="id",
            suffixes=("", "_acc"),
        )
        result = merged.groupby(["activity_date", "person"])["amount"].sum().reset_index()
        result.columns = ["activity_date", "person", "total_amount"]
        return result.sort_values("activity_date")

    return run_query("""
        SELECT t.activity_date, a.person,
               SUM(t.amount) AS total_amount
        FROM investment_accounts_tracking t
        JOIN investment_accounts a ON t.investment_accounts_id = a.id
        GROUP BY t.activity_date, a.person
        ORDER BY t.activity_date
    """)


def get_net_worth_by_category_over_time() -> pd.DataFrame:
    """Get net worth per quarter per person per account type category."""
    if is_mock_mode():
        accounts = get_investment_accounts()
        tracking = get_investment_tracking()
        merged = tracking.merge(
            accounts[["id", "person", "account_type_category"]],
            left_on="investment_accounts_id",
            right_on="id",
            suffixes=("", "_acc"),
        )
        result = (
            merged.groupby(["activity_date", "person", "account_type_category"])["amount"]
            .sum()
            .reset_index()
        )
        result.columns = ["activity_date", "person", "account_type_category", "total_amount"]
        return result.sort_values("activity_date")

    return run_query("""
        SELECT t.activity_date, a.person, a.account_type_category,
               SUM(t.amount) AS total_amount
        FROM investment_accounts_tracking t
        JOIN investment_accounts a ON t.investment_accounts_id = a.id
        GROUP BY t.activity_date, a.person, a.account_type_category
        ORDER BY t.activity_date
    """)
