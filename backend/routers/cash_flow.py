"""Cash Flow REST endpoints."""

import pandas as pd
from fastapi import APIRouter, Query

from backend.cache import ttl_cached
from backend.data import (
    aggregate_monthly_cash_flow,
    aggregate_yearly_cash_flow,
    get_all_cash_flow,
    get_distinct_persons,
    get_monthly_cash_flow_by_account,
)
from src.db.queries.transactions import get_all_transactions
from src.settings import load_settings
from src.utils.calculations import prepare_sankey_data

router = APIRouter(prefix="/cash-flow")

_cash_flow = ttl_cached(get_all_cash_flow)
_persons = ttl_cached(get_distinct_persons)


def _load_transactions_for_sankey() -> pd.DataFrame:
    """Transactions signed by intent, so charged_amount > 0 identifies expenses.

    No per-account sign flip here: the accounts listed in
    ``sign_flipped_accounts`` hold only manual rows, which
    ``normalize_manual_signs`` has already signed from their cash_flow_type.
    """
    df = get_all_transactions().copy()
    df["activity_date"] = pd.to_datetime(df["activity_date"])
    if "person" not in df.columns:
        mapping = load_settings().get("account_person_mapping", {})
        df["person"] = df["account"].map(mapping)
    return df


_transactions = ttl_cached(_load_transactions_for_sankey)


@router.get("/meta")
def meta():
    df = _cash_flow()
    years = sorted(df["year"].unique().tolist())
    months = sorted({f"{int(y)}-{int(m):02d}" for y, m in zip(df["year"], df["month"])})
    return {"persons": _persons(), "available_years": years, "available_months": months}


@router.get("/yearly")
def yearly(person: str | None = Query(None)):
    df = aggregate_yearly_cash_flow(_cash_flow(), person=person)
    return df.to_dict(orient="records")


@router.get("/monthly")
def monthly(year: int = Query(...), person: str | None = Query(None)):
    df = aggregate_monthly_cash_flow(_cash_flow(), year=year, person=person)
    return df.to_dict(orient="records")


@router.get("/monthly-by-account")
def monthly_by_account(year: int = Query(...), person: str | None = Query(None)):
    df = get_monthly_cash_flow_by_account(_cash_flow(), year=year, person=person)
    return df.to_dict(orient="records")


@router.get("/sankey")
def sankey(
    year: int = Query(...),
    person: str | None = Query(None),
    expanded: str | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
):
    expanded_set = set(expanded.split(",")) if expanded else set()
    data = prepare_sankey_data(
        _transactions(),
        _cash_flow(),
        year,
        person=person,
        expanded_categories=expanded_set,
        month=month,
    )
    return data
