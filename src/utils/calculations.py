import pandas as pd

from src.constants import ACCOUNT_TYPE_CATEGORY_MAP


def translate_account_type_category(df: pd.DataFrame) -> pd.DataFrame:
    """Translate Hebrew account_type_category to English."""
    df = df.copy()
    df["category_en"] = df["account_type_category"].map(ACCOUNT_TYPE_CATEGORY_MAP)
    return df


def calculate_net_worth_summary(accounts_df: pd.DataFrame) -> dict:
    """Calculate total net worth and per-person breakdown."""
    total = accounts_df["latest_amount"].sum()
    by_person = accounts_df.groupby("person")["latest_amount"].sum().to_dict()
    by_category = (
        translate_account_type_category(accounts_df)
        .groupby("category_en")["latest_amount"]
        .sum()
        .to_dict()
    )
    return {"total": total, "by_person": by_person, "by_category": by_category}


def calculate_yoy_change(net_worth_df: pd.DataFrame, current_year: int) -> dict:
    """Calculate year-over-year percentage change in net worth."""
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

    # Overall
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
    """Calculate average monthly income and expense for a year."""
    year_data = cash_flow_df[cash_flow_df["year"] == year]
    monthly = year_data.groupby("month").agg(
        income=("income", "sum"),
        expense=("expense", "sum"),
    )
    return {
        "avg_income": monthly["income"].mean() if len(monthly) > 0 else 0,
        "avg_expense": monthly["expense"].mean() if len(monthly) > 0 else 0,
    }


def pivot_cash_flow_table(cash_flow_df: pd.DataFrame, person: str | None = None) -> pd.DataFrame:
    """Pivot cash flow so accounts become columns for expenses."""
    df = cash_flow_df.copy()
    if person:
        df = df[df["person"] == person]

    # Pivot accounts to columns for expense
    expense_pivot = df.pivot_table(
        index=["year", "month"],
        columns="account",
        values="expense",
        aggfunc="sum",
        fill_value=0,
    )
    expense_pivot.columns = [f"{col} Expense" for col in expense_pivot.columns]

    # Aggregate other columns
    agg = (
        df.groupby(["year", "month"])
        .agg(
            income=("income", "sum"),
            money_transferred=("money_transferred", "sum"),
            total_expense=("expense", "sum"),
            savings=("savings", "sum"),
        )
        .reset_index()
    )

    agg["income_expense_diff"] = agg["income"] - agg["total_expense"]
    agg["savings_pct"] = (agg["income_expense_diff"] / agg["income"] * 100).round(1).where(agg["income"] > 0, 0)

    result = agg.merge(expense_pivot.reset_index(), on=["year", "month"], how="left")
    return result.sort_values(["year", "month"])


def aggregate_household_cash_flow(cash_flow_df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate cash flow across all persons."""
    agg = (
        cash_flow_df.groupby(["year", "month"])
        .agg(
            income=("income", "sum"),
            expense=("expense", "sum"),
            money_transferred=("money_transferred", "sum"),
            savings=("savings", "sum"),
        )
        .reset_index()
    )

    agg["income_expense_diff"] = agg["income"] - agg["expense"]
    agg["savings_pct"] = (agg["income_expense_diff"] / agg["income"] * 100).round(1).where(agg["income"] > 0, 0)

    # Running averages
    agg["avg_income"] = agg.groupby("year")["income"].transform(
        lambda x: x.expanding().mean().round(0)
    )
    agg["avg_expense"] = agg.groupby("year")["expense"].transform(
        lambda x: x.expanding().mean().round(0)
    )

    return agg.sort_values(["year", "month"])


def aggregate_yearly_cash_flow(
    cash_flow_df: pd.DataFrame, person: str | None = None
) -> pd.DataFrame:
    """Aggregate cash flow by year, optionally filtered by person."""
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


def detect_subscriptions(transactions_df: pd.DataFrame, min_months: int = 6) -> pd.DataFrame:
    """Detect recurring charges that appear in at least min_months months."""
    df = transactions_df.copy()
    df["year_month"] = df["activity_date"].dt.to_period("M")

    desc_months = df.groupby("processed_description")["year_month"].nunique().reset_index()
    desc_months.columns = ["processed_description", "month_count"]

    recurring = desc_months[desc_months["month_count"] >= min_months]

    avg_amount = (
        df[df["processed_description"].isin(recurring["processed_description"])]
        .groupby("processed_description")["charged_amount"]
        .agg(["mean", "std", "count"])
        .reset_index()
    )
    avg_amount.columns = [
        "processed_description",
        "avg_amount",
        "std_amount",
        "total_charges",
    ]

    result = recurring.merge(avg_amount, on="processed_description")
    # Filter for relatively consistent amounts (low std relative to mean)
    result = result[(result["std_amount"] / result["avg_amount"].abs()).fillna(0) < 0.5]
    return result.sort_values("avg_amount", ascending=False)


def prepare_sankey_data(
    transactions_df: pd.DataFrame,
    cash_flow_df: pd.DataFrame,
    year: int,
    person: str | None = None,
    expanded_categories: set[str] | None = None,
) -> dict:
    """Prepare nodes and links for a yearly cash flow Sankey diagram.

    Flow: Income → expense categories / savings → subcategories.

    Args:
        expanded_categories: set of category names whose subcategories should
            be shown. Categories not in this set are leaf nodes. If None,
            no subcategories are shown.

    Returns dict with keys:
        "nodes" (list of dicts with "name"),
        "links" (list of dicts with "source", "target", "value"),
        "expandable_categories" (list of category names that have >1 subcategory).
    """
    empty = {"nodes": [], "links": [], "expandable_categories": []}

    cf = cash_flow_df[cash_flow_df["year"] == year].copy()
    txn = transactions_df[transactions_df["activity_date"].dt.year == year].copy()

    if person:
        cf = cf[cf["person"] == person]
        txn = txn[txn["person"] == person]

    total_income = abs(cf["income"].sum())
    total_savings = cf["savings"].sum()

    if total_income == 0:
        return empty

    expanded = expanded_categories or set()

    # Only positive charges are expenses; exclude uncategorized
    expenses = txn[(txn["charged_amount"] > 0) & txn["category"].notna()].copy()

    # --- Build category → subcategory aggregations ---
    cat_totals = expenses.groupby("category")["charged_amount"].sum()
    subcat_totals = expenses.groupby(["category", "subcategory"])["charged_amount"].sum()

    # Sort categories by value descending (largest first)
    savings_value = abs(total_savings)
    category_names = cat_totals.sort_values(ascending=False).index.tolist()

    # Determine which categories are expandable (>1 subcategory),
    # preserving the value-sorted order
    expandable: list[str] = []
    for cat in category_names:
        if cat in subcat_totals.index.get_level_values(0):
            cat_subs = subcat_totals.loc[cat]
            if len(cat_subs) > 1:
                expandable.append(cat)

    # --- Build nodes with depth ---
    # depth 0: Income, depth 1: categories + savings, depth 2: subcategories
    nodes: list[dict] = [{"name": "Income", "depth": 0}]

    # Categories sorted by value (largest first) — interleave subcategories
    # right after their parent so ECharts places them adjacently
    for cat in category_names:
        nodes.append({"name": cat, "depth": 1})
        if cat in expanded and cat in expandable:
            cat_subs = subcat_totals.loc[cat].sort_values(ascending=False)
            for sub in cat_subs.index.tolist():
                nodes.append({"name": f"{cat} — {sub}", "depth": 2})

    if savings_value > 0:
        nodes.append({"name": "Savings", "depth": 1})

    # --- Build links ---
    links: list[dict] = []

    # Income → each category (in value-sorted order)
    for cat in category_names:
        links.append({"source": "Income", "target": cat, "value": round(cat_totals[cat], 0)})

    # Income → Savings
    if savings_value > 0:
        links.append({"source": "Income", "target": "Savings", "value": round(savings_value, 0)})

    # Category → subcategories (only for expanded categories)
    for cat in category_names:
        if cat in expanded and cat in expandable:
            cat_subs = subcat_totals.loc[cat].sort_values(ascending=False)
            for sub, val in cat_subs.items():
                links.append({"source": cat, "target": f"{cat} — {sub}", "value": round(val, 0)})

    return {
        "nodes": nodes,
        "links": links,
        "expandable_categories": expandable,
    }
