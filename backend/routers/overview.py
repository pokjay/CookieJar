"""Overview REST endpoints."""

from fastapi import APIRouter, Query

from src.constants import ACCOUNT_TYPE_CATEGORY_MAP

from backend.cache import ttl_cached
from backend.data import (
    aggregate_monthly_cash_flow,
    aggregate_yearly_cash_flow,
    calculate_avg_monthly_income_expense,
    calculate_net_worth_summary,
    calculate_yoy_change,
    get_all_cash_flow,
    get_distinct_persons,
    get_investment_accounts_with_latest,
    get_net_worth_by_category_over_time,
    get_net_worth_over_time,
)

router = APIRouter(prefix="/overview")

_accounts = ttl_cached(get_investment_accounts_with_latest)
_net_worth = ttl_cached(get_net_worth_over_time)
_net_worth_by_cat = ttl_cached(get_net_worth_by_category_over_time)
_cash_flow = ttl_cached(get_all_cash_flow)
_persons = ttl_cached(get_distinct_persons)


@router.get("/summary")
def summary():
    s = calculate_net_worth_summary(_accounts())
    cf = _cash_flow()
    years = sorted(cf["year"].unique().tolist())
    return {
        "total": s["total"],
        "by_person": s["by_person"],
        "by_category": s["by_category"],
        "persons": _persons(),
        "available_years": years,
    }


@router.get("/yoy-change")
def yoy_change(year: int = Query(...)):
    return calculate_yoy_change(_net_worth(), year)


@router.get("/avg-monthly")
def avg_monthly(year: int = Query(...)):
    return calculate_avg_monthly_income_expense(_cash_flow(), year)


@router.get("/net-worth-over-time")
def net_worth_over_time(persons: str = Query(...)):
    person_list = [p.strip() for p in persons.split(",") if p.strip()]
    nw = _net_worth()
    df = nw[nw["person"].isin(person_list)].copy()
    if df.empty:
        return []
    pivot = (
        df.pivot_table(index="activity_date", columns="person", values="total_amount", aggfunc="sum")
        .sort_index()
        .ffill()
    )
    result = pivot.reset_index().melt(id_vars="activity_date", var_name="person", value_name="total_amount")
    result = result.dropna(subset=["total_amount"])
    result["activity_date"] = result["activity_date"].dt.strftime("%Y-%m-%d")
    return result[["activity_date", "person", "total_amount"]].to_dict(orient="records")


@router.get("/net-worth-by-category")
def net_worth_by_category(person: str | None = Query(None)):
    df = _net_worth_by_cat().copy()
    if person:
        df = df[df["person"] == person]
    df["category"] = df["account_type_category"].map(ACCOUNT_TYPE_CATEGORY_MAP)
    df = df.dropna(subset=["category"])
    if df.empty:
        return []
    # Pivot wide, forward-fill holes, melt back to long format.
    # aggfunc="sum" collapses multiple persons into one value per date+category.
    pivot = (
        df.pivot_table(index="activity_date", columns="category", values="total_amount", aggfunc="sum")
        .sort_index()
        .ffill()
    )
    result = pivot.reset_index().melt(id_vars="activity_date", var_name="category", value_name="amount")
    result = result.dropna(subset=["amount"])
    result["activity_date"] = result["activity_date"].dt.strftime("%Y-%m-%d")
    return result[["activity_date", "category", "amount"]].to_dict(orient="records")


@router.get("/cash-flow/yearly")
def cash_flow_yearly(person: str | None = Query(None)):
    df = aggregate_yearly_cash_flow(_cash_flow(), person=person)
    return df.to_dict(orient="records")


@router.get("/cash-flow/monthly")
def cash_flow_monthly(year: int = Query(...), person: str | None = Query(None)):
    df = aggregate_monthly_cash_flow(_cash_flow(), year=year, person=person)
    return df.to_dict(orient="records")
