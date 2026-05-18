"""Data access and computation layer for transactions dashboard endpoints."""

from __future__ import annotations

import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_transactions
from src.settings import load_settings

_MONTH_NAMES = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}

_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _apply_sign_flip(df: pd.DataFrame) -> pd.DataFrame:
    accounts = load_settings().get("sign_flipped_accounts", [])
    if not accounts:
        return df
    mask = df["account"].isin(accounts)
    df.loc[mask, "charged_amount"] = -df.loc[mask, "charged_amount"]
    return df


def get_travel_transactions() -> pd.DataFrame:
    """Fetch only Travel category transactions with year/month/dow enrichment."""
    if is_mock_mode():
        df = get_transactions()
    else:
        df = run_query(
            "SELECT * FROM processed_transcations_with_categories ORDER BY activity_date DESC"
        )
    df = df.copy()
    df["activity_date"] = pd.to_datetime(df["activity_date"])
    df = df[df["category"] == "Travel"]
    df["year"] = df["activity_date"].dt.year
    df["month"] = df["activity_date"].dt.month
    df["dow"] = df["activity_date"].dt.dayofweek
    if "person" not in df.columns:
        mapping = load_settings().get("account_person_mapping", {})
        df["person"] = df["account"].map(mapping)
    return _apply_sign_flip(df)


def get_transactions_excl_travel() -> pd.DataFrame:
    """Fetch all processed transactions excluding Travel category (keeps uncategorized)."""
    if is_mock_mode():
        df = get_transactions()
    else:
        df = run_query(
            "SELECT * FROM processed_transcations_with_categories ORDER BY activity_date DESC"
        )

    df = df.copy()
    df["activity_date"] = pd.to_datetime(df["activity_date"])
    # Exclude Travel but keep uncategorized
    df = df[(df["category"] != "Travel") | df["category"].isna()]
    df["year"] = df["activity_date"].dt.year
    df["month"] = df["activity_date"].dt.month
    df["dow"] = df["activity_date"].dt.dayofweek  # 0=Mon
    if "person" not in df.columns:
        mapping = load_settings().get("account_person_mapping", {})
        df["person"] = df["account"].map(mapping)
    return _apply_sign_flip(df)


def get_distinct_persons_from_transactions(df: pd.DataFrame) -> list[str]:
    if "person" not in df.columns:
        return []
    return sorted(df["person"].dropna().unique().tolist())


# ---------------------------------------------------------------------------
# Data Health
# ---------------------------------------------------------------------------

def compute_data_health(df: pd.DataFrame, year: int) -> dict:
    year_df = df[df["year"] == year]
    last_date = df["activity_date"].max()
    uncat = df[df["category"].isna()]
    total = len(df)
    uncat_count = len(uncat)
    uncat_pct = round(uncat_count / total * 100, 1) if total > 0 else 0.0
    total_spend = round(float(year_df["charged_amount"].sum()), 2)
    return {
        "last_transaction_date": last_date.strftime("%Y-%m-%d") if pd.notna(last_date) else None,
        "uncategorized_count": uncat_count,
        "uncategorized_pct": uncat_pct,
        "total_spend": total_spend,
    }


# ---------------------------------------------------------------------------
# YoY Spend
# ---------------------------------------------------------------------------

def compute_yoy_spend(df: pd.DataFrame) -> list[dict]:
    agg = (
        df.groupby("year")["charged_amount"]
        .sum()
        .reset_index()
        .rename(columns={"charged_amount": "total_spend"})
    )
    agg["total_spend"] = agg["total_spend"].round(2)
    return agg.sort_values("year").to_dict(orient="records")


# ---------------------------------------------------------------------------
# Monthly YoY
# ---------------------------------------------------------------------------

def compute_monthly_yoy(df: pd.DataFrame, year: int) -> list[dict]:
    """Monthly spend for the selected year and up to 2 prior years (for YoY overlay)."""
    all_years = sorted(df["year"].unique())
    idx = all_years.index(year) if year in all_years else len(all_years) - 1
    years_to_show = all_years[max(0, idx - 2): idx + 1]

    filtered = df[df["year"].isin(years_to_show)]
    agg = (
        filtered.groupby(["year", "month"])["charged_amount"]
        .sum()
        .reset_index()
        .rename(columns={"charged_amount": "spend"})
    )
    agg["month_name"] = agg["month"].map(_MONTH_NAMES)
    agg["spend"] = agg["spend"].round(2)
    return agg.sort_values(["year", "month"]).to_dict(orient="records")


# ---------------------------------------------------------------------------
# Monthly by Account
# ---------------------------------------------------------------------------

def compute_monthly_by_account(df: pd.DataFrame, year: int) -> list[dict]:
    year_df = df[df["year"] == year]
    if "account" not in year_df.columns:
        return []
    agg = (
        year_df.groupby(["month", "account"])["charged_amount"]
        .sum()
        .reset_index()
        .rename(columns={"charged_amount": "spend"})
    )
    agg["month_name"] = agg["month"].map(_MONTH_NAMES)
    agg["spend"] = agg["spend"].round(2)
    return agg.sort_values("month").to_dict(orient="records")


# ---------------------------------------------------------------------------
# Avg Monthly Spend by Category
# ---------------------------------------------------------------------------

def compute_avg_by_category(df: pd.DataFrame, year: int) -> list[dict]:
    year_df = df[(df["year"] == year) & df["category"].notna()]
    if year_df.empty:
        return []
    monthly = (
        year_df.groupby(["month", "category"])["charged_amount"]
        .sum()
        .reset_index()
    )
    avg = (
        monthly.groupby("category")["charged_amount"]
        .mean()
        .reset_index()
        .rename(columns={"charged_amount": "avg_monthly_spend"})
    )
    avg["avg_monthly_spend"] = avg["avg_monthly_spend"].round(2)
    return avg.sort_values("avg_monthly_spend", ascending=False).to_dict(orient="records")


# ---------------------------------------------------------------------------
# Subscriptions (recurring charges)
# ---------------------------------------------------------------------------

def compute_subscriptions(df: pd.DataFrame, year: int) -> list[dict]:
    """Detect recurring charges: same processed_description, ≥10 occurrences, low std dev."""
    year_df = df[df["year"] == year].copy()
    if year_df.empty or "processed_description" not in year_df.columns:
        return []

    MIN_COUNT = 10
    MAX_CV = 0.5  # coefficient of variation threshold

    agg = (
        year_df.groupby("processed_description")["charged_amount"]
        .agg(["count", "mean", "std", "sum", "max"])
        .reset_index()
    )
    agg.columns = [
        "name", "total_charges", "avg_amount", "std_amount", "total_spend", "max_amount"
    ]
    # Filter: at least MIN_COUNT occurrences
    agg = agg[agg["total_charges"] >= MIN_COUNT]
    # Filter: low std dev relative to mean (consistent amounts)
    cv = (agg["std_amount"] / agg["avg_amount"].abs()).fillna(0)
    agg = agg[cv < MAX_CV]

    agg["avg_amount"] = agg["avg_amount"].round(2)
    agg["max_amount"] = agg["max_amount"].round(2)
    agg["total_spend"] = agg["total_spend"].round(2)

    return (
        agg[["name", "max_amount", "total_charges", "total_spend"]]
        .sort_values("total_spend", ascending=False)
        .to_dict(orient="records")
    )


# ---------------------------------------------------------------------------
# Category Trends
# ---------------------------------------------------------------------------

def compute_category_trends(df: pd.DataFrame, year: int) -> list[dict]:
    """Monthly spend per category for mini trend grid."""
    year_df = df[(df["year"] == year) & df["category"].notna()]
    if year_df.empty:
        return []
    agg = (
        year_df.groupby(["category", "month"])["charged_amount"]
        .sum()
        .reset_index()
        .rename(columns={"charged_amount": "spend"})
    )
    agg["month_name"] = agg["month"].map(_MONTH_NAMES)
    agg["spend"] = agg["spend"].round(2)
    return agg.sort_values(["category", "month"]).to_dict(orient="records")


# ---------------------------------------------------------------------------
# Top Businesses
# ---------------------------------------------------------------------------

def compute_top_businesses(df: pd.DataFrame, year: int) -> list[dict]:
    year_df = df[df["year"] == year]
    col = "processed_description" if "processed_description" in year_df.columns else "description"
    if col not in year_df.columns:
        return []
    agg = (
        year_df.groupby(col)["charged_amount"]
        .sum()
        .reset_index()
        .rename(columns={col: "name", "charged_amount": "total_spend"})
    )
    agg["total_spend"] = agg["total_spend"].round(2)
    return (
        agg.sort_values("total_spend", ascending=False)
        .head(15)
        .to_dict(orient="records")
    )


# ---------------------------------------------------------------------------
# Uncategorized Transactions
# ---------------------------------------------------------------------------

def compute_uncategorized(df: pd.DataFrame, year: int) -> list[dict]:
    year_df = df[(df["year"] == year) & df["category"].isna()]
    if year_df.empty:
        return []
    col = "description" if "description" in year_df.columns else "processed_description"
    agg = (
        year_df.groupby(col)
        .agg(count=("charged_amount", "count"), total=("charged_amount", "sum"))
        .reset_index()
        .rename(columns={col: "description"})
    )
    agg["total"] = agg["total"].round(2)
    return agg.sort_values("total", ascending=False).to_dict(orient="records")


# ---------------------------------------------------------------------------
# Spending Heatmap (category × day-of-week)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Travel Trips
# ---------------------------------------------------------------------------

def _format_trip_label(start: pd.Timestamp, end: pd.Timestamp) -> str:
    if start.date() == end.date():
        return start.strftime("%-d %b %Y")
    if start.year == end.year:
        return f"{start.strftime('%-d %b')} – {end.strftime('%-d %b %Y')}"
    return f"{start.strftime('%-d %b %Y')} – {end.strftime('%-d %b %Y')}"


def compute_travel_trips(df: pd.DataFrame, gap_days: int = 5) -> list[dict]:
    """Detect individual trips by clustering consecutive travel transactions.

    A new trip starts when the gap to the previous transaction exceeds gap_days.
    Uses vectorized diff()+cumsum() rather than row-by-row iteration.
    """
    if df.empty:
        return []

    df = df.sort_values("activity_date").reset_index(drop=True)
    df = df.copy()
    # diff() on the first row yields NaT, which evaluates False in the comparison,
    # so the first row correctly starts trip group 0.
    df["_trip_id"] = (
        df["activity_date"].diff() > pd.Timedelta(days=gap_days)
    ).cumsum()

    trips = []
    for _, group in df.groupby("_trip_id"):
        start = group["activity_date"].min()
        end = group["activity_date"].max()
        top_subs = (
            group[group["subcategory"].notna()]
            .groupby("subcategory")["charged_amount"]
            .sum()
            .sort_values(ascending=False)
            .head(3)
            .reset_index()
            .rename(columns={"charged_amount": "spend"})
        )
        top_subs["spend"] = top_subs["spend"].round(2)
        trips.append({
            "year": int(start.year),
            "trip_label": _format_trip_label(start, end),
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date": end.strftime("%Y-%m-%d"),
            "total_spend": round(float(group["charged_amount"].sum()), 2),
            "transaction_count": int(len(group)),
            "top_subcategories": top_subs.to_dict(orient="records"),
        })

    return sorted(trips, key=lambda t: (t["year"], t["start_date"]), reverse=True)


def compute_heatmap(df: pd.DataFrame, year: int) -> list[dict]:
    year_df = df[(df["year"] == year) & df["category"].notna()]
    if year_df.empty:
        return []
    agg = (
        year_df.groupby(["category", "dow"])["charged_amount"]
        .sum()
        .reset_index()
        .rename(columns={"charged_amount": "spend"})
    )
    agg["day_name"] = agg["dow"].map(dict(enumerate(_DAYS)))
    agg["spend"] = agg["spend"].round(2)
    return agg[["category", "dow", "day_name", "spend"]].to_dict(orient="records")
