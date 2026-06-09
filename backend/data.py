"""Data access layer for the FastAPI backend.

Cash-flow queries and calculation helpers live in ``src/`` (shared with
tests and scripts); this module re-exports them so routers have a single
import surface.
"""

import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_investment_accounts, get_investment_tracking
from src.db.queries.cash_flow import get_all_cash_flow as get_all_cash_flow
from src.utils.calculations import (
    aggregate_monthly_cash_flow as aggregate_monthly_cash_flow,
)
from src.utils.calculations import (
    aggregate_yearly_cash_flow as aggregate_yearly_cash_flow,
)
from src.utils.calculations import (
    calculate_avg_monthly_income_expense as calculate_avg_monthly_income_expense,
)
from src.utils.calculations import (
    calculate_net_worth_summary as calculate_net_worth_summary,
)
from src.utils.calculations import (
    calculate_yoy_change as calculate_yoy_change,
)
from src.utils.calculations import (
    get_monthly_cash_flow_by_account as get_monthly_cash_flow_by_account,
)


def get_distinct_persons() -> list[str]:
    if is_mock_mode():
        accounts = get_investment_accounts()
        return sorted(accounts["person"].unique().tolist())
    df = run_query("SELECT DISTINCT person FROM investment_accounts ORDER BY person")
    return df["person"].tolist()


def get_investment_accounts_with_latest() -> pd.DataFrame:
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
            latest, left_on="id", right_on="investment_accounts_id", how="left"
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


def forward_fill_account_balances(tracking: pd.DataFrame) -> pd.DataFrame:
    """Carry each account's last known balance across the union of tracking dates.

    Different accounts often get tracked on different dates (e.g. moneyman scrapes
    each account whenever it next runs). Summing raw tracking rows by date drops
    accounts that weren't scraped that day, which appears as dips in the net-worth
    chart. Forward-filling per account before aggregating avoids that.

    Returns long-form (activity_date, investment_accounts_id, amount) with one row
    per (date, account) where the account has any tracking record up to that date.
    """
    if tracking.empty:
        return pd.DataFrame(
            columns=["activity_date", "investment_accounts_id", "amount"]
        )

    sort_cols = ["activity_date", "investment_accounts_id"]
    if "id" in tracking.columns:
        sort_cols.append("id")
    tracking = tracking.sort_values(sort_cols)

    wide = (
        tracking.pivot_table(
            index="activity_date",
            columns="investment_accounts_id",
            values="amount",
            aggfunc="last",
        )
        .sort_index()
        .ffill()
    )
    long = wide.reset_index().melt(
        id_vars="activity_date",
        var_name="investment_accounts_id",
        value_name="amount",
    )
    return long.dropna(subset=["amount"]).reset_index(drop=True)


def get_net_worth_over_time() -> pd.DataFrame:
    if is_mock_mode():
        accounts = get_investment_accounts()
        tracking = get_investment_tracking()
    else:
        accounts = run_query("SELECT id, person FROM investment_accounts")
        tracking = run_query(
            "SELECT id, investment_accounts_id, activity_date, amount "
            "FROM investment_accounts_tracking "
            "ORDER BY activity_date, investment_accounts_id, id"
        )
        tracking["activity_date"] = pd.to_datetime(tracking["activity_date"])

    filled = forward_fill_account_balances(tracking)
    if filled.empty:
        return pd.DataFrame(columns=["activity_date", "person", "total_amount"])

    merged = filled.merge(
        accounts[["id", "person"]],
        left_on="investment_accounts_id",
        right_on="id",
    )
    result = (
        merged.groupby(["activity_date", "person"])["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "total_amount"})
    )
    return result.sort_values("activity_date").reset_index(drop=True)


def get_net_worth_by_category_over_time() -> pd.DataFrame:
    if is_mock_mode():
        accounts = get_investment_accounts()
        tracking = get_investment_tracking()
    else:
        accounts = run_query(
            "SELECT id, person, account_type_category FROM investment_accounts"
        )
        tracking = run_query(
            "SELECT id, investment_accounts_id, activity_date, amount "
            "FROM investment_accounts_tracking "
            "ORDER BY activity_date, investment_accounts_id, id"
        )
        tracking["activity_date"] = pd.to_datetime(tracking["activity_date"])

    filled = forward_fill_account_balances(tracking)
    if filled.empty:
        return pd.DataFrame(
            columns=["activity_date", "person", "account_type_category", "total_amount"]
        )

    merged = filled.merge(
        accounts[["id", "person", "account_type_category"]],
        left_on="investment_accounts_id",
        right_on="id",
    )
    result = (
        merged.groupby(["activity_date", "person", "account_type_category"])["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "total_amount"})
    )
    return result.sort_values("activity_date").reset_index(drop=True)
