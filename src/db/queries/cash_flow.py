import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_cash_flow
from src.settings import load_settings


def _get_cash_flow_settings() -> tuple[list[str], dict[str, str], list[str]]:
    """Return (cash_flow_accounts, account_person_mapping, sign_flipped_accounts) from settings."""
    settings = load_settings()
    return (
        settings.get("cash_flow_accounts", []),
        settings.get("account_person_mapping", {}),
        settings.get("sign_flipped_accounts", []),
    )


def _derive_cash_flow_from_manual(
    cash_flow_accounts: list[str],
    account_person_mapping: dict[str, str],
    sign_flipped_accounts: list[str] | None = None,
) -> pd.DataFrame:
    """Derive monthly cash flow rows from transactions_manual for the configured bank accounts."""
    if not cash_flow_accounts:
        return pd.DataFrame(columns=["year", "month", "person", "account", "income", "expense", "money_transferred", "savings"])

    placeholders = ", ".join(f":acct_{i}" for i in range(len(cash_flow_accounts)))
    params = {f"acct_{i}": acct for i, acct in enumerate(cash_flow_accounts)}

    df = run_query(
        f"""
        SELECT
            account,
            activity_date,
            charged_amount,
            COALESCE(cash_flow_type, 'expense') AS cash_flow_type
        FROM transactions_manual
        WHERE account IN ({placeholders})
        """,
        params,
    )

    if df.empty:
        return pd.DataFrame(columns=["year", "month", "person", "account", "income", "expense", "money_transferred", "savings"])

    df["activity_date"] = pd.to_datetime(df["activity_date"])
    df["year"] = df["activity_date"].dt.year
    df["month"] = df["activity_date"].dt.month
    df["person"] = df["account"].map(account_person_mapping)

    if sign_flipped_accounts:
        mask = df["account"].isin(sign_flipped_accounts)
        df.loc[mask, "charged_amount"] = -df.loc[mask, "charged_amount"]

    # Derive cash flow columns from cash_flow_type. The monthly_cash_flow
    # table (and mock data) store all columns as positive magnitudes, so use
    # absolute amounts regardless of each bank's debit/credit sign convention.
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

    agg = (
        df.groupby(["year", "month", "person", "account"])
        .agg(
            income=("income", "sum"),
            expense=("expense", "sum"),
            money_transferred=("money_transferred", "sum"),
            savings=("savings", "sum"),
        )
        .reset_index()
    )
    return agg


def _merge_with_transactions_precedence(base: pd.DataFrame, from_transactions: pd.DataFrame) -> pd.DataFrame:
    """Merge cash flow table with transactions-derived data. Transactions take precedence for entire months."""
    if from_transactions.empty:
        return base

    if base.empty:
        return from_transactions

    # If transactions exist for a (year, month), drop ALL base rows for that month
    txn_months = set(zip(from_transactions["year"], from_transactions["month"]))
    mask = [
        (row.year, row.month) not in txn_months
        for row in base.itertuples()
    ]
    base_kept = base[mask]

    return pd.concat([base_kept, from_transactions], ignore_index=True)


def get_all_cash_flow() -> pd.DataFrame:
    """Get all monthly cash flow records, supplemented by transactions_manual.

    For any month where transactions_manual has data for the configured cash flow
    accounts, the ENTIRE month from the monthly_cash_flow table is replaced.
    This means transactions_manual must contain ALL bank account transactions for
    that month (all accounts, all persons) — partial data will result in incomplete
    cash flow for that month.
    """
    if is_mock_mode():
        return get_cash_flow()

    base = run_query("SELECT * FROM monthly_cash_flow ORDER BY year, month, person, account")

    cash_flow_accounts, account_person_mapping, sign_flipped_accounts = _get_cash_flow_settings()
    fallback = _derive_cash_flow_from_manual(cash_flow_accounts, account_person_mapping, sign_flipped_accounts)

    result = _merge_with_transactions_precedence(base, fallback)
    return result.sort_values(["year", "month", "person", "account"]).reset_index(drop=True)


def get_cash_flow_month_detail(year: int, month: int) -> pd.DataFrame:
    """Get individual transactions from transactions_manual for a specific month and the configured cash flow accounts."""
    if is_mock_mode():
        return pd.DataFrame()

    cash_flow_accounts, account_person_mapping, sign_flipped_accounts = _get_cash_flow_settings()
    if not cash_flow_accounts:
        return pd.DataFrame()

    placeholders = ", ".join(f":acct_{i}" for i in range(len(cash_flow_accounts)))
    params = {f"acct_{i}": acct for i, acct in enumerate(cash_flow_accounts)}
    params["year"] = year
    params["month"] = month

    df = run_query(
        f"""
        SELECT
            activity_date,
            account,
            description,
            charged_amount,
            COALESCE(cash_flow_type, 'expense') AS cash_flow_type
        FROM transactions_manual
        WHERE account IN ({placeholders})
          AND EXTRACT(YEAR FROM activity_date) = :year
          AND EXTRACT(MONTH FROM activity_date) = :month
        ORDER BY activity_date, charged_amount
        """,
        params,
    )

    if not df.empty:
        df["person"] = df["account"].map(account_person_mapping)
        if sign_flipped_accounts:
            mask = df["account"].isin(sign_flipped_accounts)
            df.loc[mask, "charged_amount"] = -df.loc[mask, "charged_amount"]

    return df


def get_cash_flow_by_year(year: int) -> pd.DataFrame:
    """Get cash flow records for a specific year."""
    if is_mock_mode():
        df = get_cash_flow()
        return df[df["year"] == year]

    df = get_all_cash_flow()
    return df[df["year"] == year]
