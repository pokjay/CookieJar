"""Data access layer for the FastAPI backend."""

import pandas as pd

from src.constants import ACCOUNT_TYPE_CATEGORY_MAP
from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_cash_flow, get_investment_accounts, get_investment_tracking
from src.settings import load_settings


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


def _derive_cash_flow_from_manual(
    cash_flow_accounts: list[str],
    account_person_mapping: dict[str, str],
    sign_flipped_accounts: list[str] | None = None,
) -> pd.DataFrame:
    empty = pd.DataFrame(columns=["year", "month", "person", "account", "income", "expense", "money_transferred", "savings"])
    if not cash_flow_accounts:
        return empty

    placeholders = ", ".join(f":acct_{i}" for i in range(len(cash_flow_accounts)))
    params = {f"acct_{i}": acct for i, acct in enumerate(cash_flow_accounts)}

    df = run_query(
        f"""
        SELECT account, activity_date, charged_amount,
               COALESCE(cash_flow_type, 'expense') AS cash_flow_type
        FROM transactions_manual
        WHERE account IN ({placeholders})
        """,
        params,
    )

    if df.empty:
        return empty

    df["activity_date"] = pd.to_datetime(df["activity_date"])
    df["year"] = df["activity_date"].dt.year
    df["month"] = df["activity_date"].dt.month
    df["person"] = df["account"].map(account_person_mapping)

    if sign_flipped_accounts:
        mask = df["account"].isin(sign_flipped_accounts)
        df.loc[mask, "charged_amount"] = -df.loc[mask, "charged_amount"]

    cft = df["cash_flow_type"]
    amt = df["charged_amount"].abs()

    df["income"] = 0.0
    df.loc[cft.isin(["salary", "other_income"]), "income"] = amt[cft.isin(["salary", "other_income"])]
    df["expense"] = 0.0
    df.loc[cft == "expense", "expense"] = amt[cft == "expense"]
    df["savings"] = 0.0
    df.loc[cft == "savings", "savings"] = amt[cft == "savings"]
    df["money_transferred"] = 0.0
    df.loc[cft == "internal_transfer", "money_transferred"] = amt[cft == "internal_transfer"]

    return (
        df.groupby(["year", "month", "person", "account"])
        .agg(
            income=("income", "sum"),
            expense=("expense", "sum"),
            money_transferred=("money_transferred", "sum"),
            savings=("savings", "sum"),
        )
        .reset_index()
    )


def _merge_with_transactions_precedence(base: pd.DataFrame, from_transactions: pd.DataFrame) -> pd.DataFrame:
    if from_transactions.empty:
        return base
    if base.empty:
        return from_transactions
    txn_months = set(zip(from_transactions["year"], from_transactions["month"]))
    mask = [(row.year, row.month) not in txn_months for row in base.itertuples()]
    return pd.concat([base[mask], from_transactions], ignore_index=True)


def get_all_cash_flow() -> pd.DataFrame:
    if is_mock_mode():
        return get_cash_flow()

    base = run_query("SELECT * FROM monthly_cash_flow ORDER BY year, month, person, account")
    settings = load_settings()
    cash_flow_accounts = settings.get("cash_flow_accounts", [])
    account_person_mapping = settings.get("account_person_mapping", {})
    sign_flipped_accounts = settings.get("sign_flipped_accounts", [])
    from_transactions = _derive_cash_flow_from_manual(cash_flow_accounts, account_person_mapping, sign_flipped_accounts)
    result = _merge_with_transactions_precedence(base, from_transactions)
    return result.sort_values(["year", "month", "person", "account"]).reset_index(drop=True)


# --- Calculation functions ---


def _translate_account_type_category(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["category_en"] = df["account_type_category"].map(ACCOUNT_TYPE_CATEGORY_MAP)
    return df


def calculate_net_worth_summary(accounts_df: pd.DataFrame) -> dict:
    total = accounts_df["latest_amount"].sum()
    by_person = accounts_df.groupby("person")["latest_amount"].sum().to_dict()
    by_category = (
        _translate_account_type_category(accounts_df)
        .groupby("category_en")["latest_amount"]
        .sum()
        .to_dict()
    )
    return {"total": total, "by_person": by_person, "by_category": by_category}


def calculate_yoy_change(net_worth_df: pd.DataFrame, current_year: int) -> dict:
    yearly = (
        net_worth_df.assign(year=net_worth_df["activity_date"].dt.year)
        .groupby(["year", "person"])["total_amount"]
        .last()
        .reset_index()
    )

    result = {}
    has_current_year = len(yearly[yearly["year"] == current_year]) > 0

    for person in yearly["person"].unique():
        person_data = yearly[yearly["person"] == person].sort_values("year")
        curr = person_data[person_data["year"] == current_year]["total_amount"]
        prev = person_data[person_data["year"] == current_year - 1]["total_amount"]
        if len(curr) > 0 and len(prev) > 0 and prev.iloc[0] > 0:
            result[person] = ((curr.iloc[0] - prev.iloc[0]) / prev.iloc[0]) * 100
        else:
            result[person] = None

    if has_current_year:
        overall_curr = yearly[yearly["year"] == current_year]["total_amount"].sum()
        overall_prev = yearly[yearly["year"] == current_year - 1]["total_amount"].sum()
        if overall_prev > 0:
            result["Overall"] = ((overall_curr - overall_prev) / overall_prev) * 100
        else:
            result["Overall"] = None
    else:
        result["Overall"] = None

    return result


def calculate_avg_monthly_income_expense(cash_flow_df: pd.DataFrame, year: int) -> dict:
    year_data = cash_flow_df[cash_flow_df["year"] == year]
    monthly = year_data.groupby("month").agg(
        income=("income", "sum"),
        expense=("expense", "sum"),
    )
    return {
        "avg_income": monthly["income"].mean() if len(monthly) > 0 else 0,
        "avg_expense": monthly["expense"].mean() if len(monthly) > 0 else 0,
    }


def aggregate_yearly_cash_flow(
    cash_flow_df: pd.DataFrame, person: str | None = None
) -> pd.DataFrame:
    df = cash_flow_df.copy()
    if person:
        df = df[df["person"] == person]

    agg = (
        df.groupby("year")
        .agg(
            income=("income", "sum"),
            expense=("expense", "sum"),
            money_transferred=("money_transferred", "sum"),
            savings=("savings", "sum"),
        )
        .reset_index()
    )

    agg["income_expense_diff"] = agg["income"] - agg["expense"]
    agg["savings_pct"] = (
        (agg["income_expense_diff"] / agg["income"] * 100)
        .round(1)
        .where(agg["income"] > 0, 0)
    )

    return agg.sort_values("year")


_MONTH_NAMES = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


def aggregate_monthly_cash_flow(
    cash_flow_df: pd.DataFrame, year: int, person: str | None = None
) -> pd.DataFrame:
    df = cash_flow_df.copy()
    if person:
        df = df[df["person"] == person]

    df = df[df["year"] == year]

    agg = (
        df.groupby(["year", "month"])
        .agg(
            income=("income", "sum"),
            expense=("expense", "sum"),
            savings=("savings", "sum"),
        )
        .reset_index()
    )
    agg["income_expense_diff"] = agg["income"] - agg["expense"]
    agg["savings_pct"] = (
        (agg["income_expense_diff"] / agg["income"] * 100)
        .round(1)
        .where(agg["income"] > 0, 0)
    )
    agg["month_name"] = agg["month"].map(_MONTH_NAMES)
    return agg.sort_values(["year", "month"])


def get_monthly_cash_flow_by_account(
    cash_flow_df: pd.DataFrame, year: int, person: str | None = None
) -> pd.DataFrame:
    df = cash_flow_df.copy()
    if person:
        df = df[df["person"] == person]
    df = df[df["year"] == year]

    agg = (
        df.groupby(["month", "account"])
        .agg(expense=("expense", "sum"), income=("income", "sum"))
        .reset_index()
    )
    agg["month_name"] = agg["month"].map(_MONTH_NAMES)
    return agg.sort_values("month")
