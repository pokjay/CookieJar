"""Travel REST endpoints — filtered to Travel category."""

import math

import pandas as pd
from fastapi import APIRouter, Query

from pydantic import BaseModel

from backend.cache import ttl_cached
from backend.data_transactions import (
    get_travel_transactions,
    get_distinct_persons_from_transactions,
    compute_data_health,
    compute_yoy_spend,
    compute_monthly_yoy,
    compute_monthly_by_account,
    compute_avg_by_category,
    compute_category_trends,
    compute_top_businesses,
    compute_heatmap,
    compute_travel_trips,
)
from src.settings import load_settings, save_settings

router = APIRouter(prefix="/travel")

_travel_txn = ttl_cached(get_travel_transactions)


def _subcategory_as_category(df: pd.DataFrame) -> pd.DataFrame:
    """Substitute subcategory into the category column for subcategory-level breakdowns."""
    d = df.copy()
    d["category"] = d["subcategory"].fillna("Unknown")
    return d


# ---------------------------------------------------------------------------
# Browse
# ---------------------------------------------------------------------------


@router.get("/browse/meta")
def browse_meta():
    df = _travel_txn()
    df = df.copy()
    df["activity_date"] = pd.to_datetime(df["activity_date"])
    return {
        "persons": sorted(df["person"].dropna().unique().tolist()) if "person" in df.columns else [],
        "accounts": sorted(df["account"].dropna().unique().tolist()),
        "subcategories": sorted(df["subcategory"].dropna().unique().tolist()),
        "date_min": df["activity_date"].min().strftime("%Y-%m-%d"),
        "date_max": df["activity_date"].max().strftime("%Y-%m-%d"),
        "amount_min": float(df["charged_amount"].min()),
        "amount_max": float(df["charged_amount"].max()),
    }


@router.get("/browse")
def browse():
    df = _travel_txn()
    df = df.copy()
    df["activity_date"] = pd.to_datetime(df["activity_date"]).dt.strftime("%Y-%m-%d")
    cols = [
        "unique_id",
        "activity_date",
        "processed_description",
        "charged_amount",
        "charged_currency",
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
# Dashboard
# ---------------------------------------------------------------------------


@router.get("/dashboard/meta")
def dashboard_meta():
    df = _travel_txn()
    years = sorted(df["year"].unique().tolist()) if "year" in df.columns else []
    persons = get_distinct_persons_from_transactions(df)
    return {"available_years": years, "persons": persons}


@router.get("/dashboard/data-health")
def dashboard_data_health(year: int = Query(...)):
    return compute_data_health(_travel_txn(), year)


@router.get("/dashboard/yoy-spend")
def dashboard_yoy_spend():
    return compute_yoy_spend(_travel_txn())


@router.get("/dashboard/monthly-yoy")
def dashboard_monthly_yoy(year: int = Query(...)):
    return compute_monthly_yoy(_travel_txn(), year)


@router.get("/dashboard/monthly-by-account")
def dashboard_monthly_by_account(year: int = Query(...)):
    return compute_monthly_by_account(_travel_txn(), year)


@router.get("/dashboard/avg-by-subcategory")
def dashboard_avg_by_subcategory(year: int = Query(...)):
    return compute_avg_by_category(_subcategory_as_category(_travel_txn()), year)


@router.get("/dashboard/subcategory-trends")
def dashboard_subcategory_trends(year: int = Query(...)):
    return compute_category_trends(_subcategory_as_category(_travel_txn()), year)


@router.get("/dashboard/top-businesses")
def dashboard_top_businesses(year: int = Query(...)):
    return compute_top_businesses(_travel_txn(), year)


@router.get("/dashboard/heatmap")
def dashboard_heatmap(year: int = Query(...)):
    return compute_heatmap(_subcategory_as_category(_travel_txn()), year)


@router.get("/dashboard/trips")
def dashboard_trips():
    trip_names = load_settings().get("trip_names", {})
    trips = compute_travel_trips(_travel_txn())
    for trip in trips:
        trip["name"] = trip_names.get(trip["start_date"])
    return trips


class TripNamePayload(BaseModel):
    name: str | None = None


@router.put("/trips/{start_date}/name")
def set_trip_name(start_date: str, payload: TripNamePayload):
    settings = load_settings()
    trip_names = settings.get("trip_names", {})
    if payload.name:
        trip_names[start_date] = payload.name
    else:
        trip_names.pop(start_date, None)
    settings["trip_names"] = trip_names
    save_settings(settings)
    return {"ok": True}
