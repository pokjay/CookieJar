"""Transactions REST endpoints."""

import math

import pandas as pd
from fastapi import APIRouter, Query

from backend.cache import ttl_cached
from src.db.queries.transactions import get_all_transactions
from src.settings import load_settings
from backend.data_transactions import (
    _apply_sign_flip,
    get_transactions_excl_travel,
    get_distinct_persons_from_transactions,
    compute_data_health,
    compute_yoy_spend,
    compute_monthly_yoy,
    compute_monthly_by_account,
    compute_avg_by_category,
    compute_subscriptions,
    compute_category_trends,
    compute_top_businesses,
    compute_uncategorized,
    compute_heatmap,
)

router = APIRouter(prefix="/transactions")

_transactions = ttl_cached(lambda: _apply_sign_flip(get_all_transactions()))
_txn = ttl_cached(get_transactions_excl_travel)


def _excluding_travel(df: pd.DataFrame) -> pd.DataFrame:
    return df[(df["category"] != "Travel") | df["category"].isna()]


def _enrich_with_person(df: pd.DataFrame) -> pd.DataFrame:
    """Add person column from account mapping if not already present."""
    if "person" in df.columns:
        return df
    mapping = load_settings().get("account_person_mapping", {})
    df = df.copy()
    df["person"] = df["account"].map(mapping)
    return df


@router.get("/browse/meta")
def browse_meta():
    df = _enrich_with_person(_excluding_travel(_transactions()))
    df = df.copy()
    df["activity_date"] = pd.to_datetime(df["activity_date"])

    subcats: dict[str, list[str]] = {}
    for cat, group in df.dropna(subset=["category"]).groupby("category"):
        subcats[str(cat)] = sorted(group["subcategory"].dropna().unique().tolist())

    return {
        "persons": sorted(df["person"].dropna().unique().tolist()) if "person" in df.columns else [],
        "accounts": sorted(df["account"].dropna().unique().tolist()),
        "categories": sorted(df["category"].dropna().unique().tolist()),
        "subcategories_by_category": subcats,
        "date_min": df["activity_date"].min().strftime("%Y-%m-%d"),
        "date_max": df["activity_date"].max().strftime("%Y-%m-%d"),
        "amount_min": float(df["charged_amount"].min()),
        "amount_max": float(df["charged_amount"].max()),
    }


@router.get("/browse")
def browse():
    df = _enrich_with_person(_excluding_travel(_transactions()))
    df = df.copy()
    df["activity_date"] = pd.to_datetime(df["activity_date"]).dt.strftime("%Y-%m-%d")

    cols = [
        "unique_id",
        "activity_date",
        "processed_description",
        "charged_amount",
        "charged_currency",
        "category",
        "subcategory",
        "account",
        "person",
    ]
    cols = [c for c in cols if c in df.columns]
    records = df[cols].to_dict(orient="records")
    return [
        {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in row.items()}
        for row in records
    ]


# ---------------------------------------------------------------------------
# Dashboard endpoints
# ---------------------------------------------------------------------------

@router.get("/dashboard/meta")
def dashboard_meta():
    df = _txn()
    years = sorted(df["year"].unique().tolist()) if "year" in df.columns else []
    persons = get_distinct_persons_from_transactions(df)
    return {"available_years": years, "persons": persons}


@router.get("/dashboard/data-health")
def dashboard_data_health(year: int = Query(...)):
    return compute_data_health(_txn(), year)


@router.get("/dashboard/yoy-spend")
def dashboard_yoy_spend():
    return compute_yoy_spend(_txn())


@router.get("/dashboard/monthly-yoy")
def dashboard_monthly_yoy(year: int = Query(...)):
    return compute_monthly_yoy(_txn(), year)


@router.get("/dashboard/monthly-by-account")
def dashboard_monthly_by_account(year: int = Query(...)):
    return compute_monthly_by_account(_txn(), year)


@router.get("/dashboard/avg-by-category")
def dashboard_avg_by_category(year: int = Query(...)):
    return compute_avg_by_category(_txn(), year)


@router.get("/dashboard/subscriptions")
def dashboard_subscriptions(year: int = Query(...)):
    return compute_subscriptions(_txn(), year)


@router.get("/dashboard/category-trends")
def dashboard_category_trends(year: int = Query(...)):
    return compute_category_trends(_txn(), year)


@router.get("/dashboard/top-businesses")
def dashboard_top_businesses(year: int = Query(...)):
    return compute_top_businesses(_txn(), year)


@router.get("/dashboard/uncategorized")
def dashboard_uncategorized(year: int = Query(...)):
    return compute_uncategorized(_txn(), year)


@router.get("/dashboard/heatmap")
def dashboard_heatmap(year: int = Query(...)):
    return compute_heatmap(_txn(), year)
