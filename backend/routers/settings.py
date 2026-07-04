"""Settings REST endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

from backend.cache import ttl_cached
from backend.data import get_distinct_persons
from src.db.connection import execute_mutation, is_mock_mode
from src.db.queries.transactions import get_distinct_accounts
from src.settings import load_settings, save_settings

router = APIRouter(prefix="/settings")

_persons = ttl_cached(get_distinct_persons)
_accounts = ttl_cached(get_distinct_accounts)


@router.get("/persons")
def persons() -> list[str]:
    return _persons()


@router.get("/accounts")
def accounts() -> list[str]:
    return _accounts()


@router.get("")
def get_settings() -> dict:
    return load_settings()


class AppSettings(BaseModel):
    cfg_parent1: str | None = None
    cfg_parent2: str | None = None
    cfg_kids: list[str] = []
    sign_flipped_accounts: list[str] = []
    cash_flow_accounts: list[str] = []
    account_person_mapping: dict[str, str] = {}


@router.post("")
def post_settings(payload: AppSettings) -> dict:
    save_settings(payload.model_dump())
    return {"ok": True}


@router.get("/category-mappings/count")
def category_mappings_count() -> dict:
    if is_mock_mode():
        return {"count": 0}
    from src.db.connection import run_query
    df = run_query("SELECT COUNT(*) AS cnt FROM description_to_category")
    return {"count": int(df["cnt"].iloc[0])}


@router.delete("/category-mappings")
def reset_category_mappings() -> dict:
    if is_mock_mode():
        return {"ok": True, "deleted": 0}
    from src.db.connection import run_query
    df = run_query("SELECT COUNT(*) AS cnt FROM description_to_category")
    count = int(df["cnt"].iloc[0])
    execute_mutation("DELETE FROM description_to_category", {})
    _bust_category_caches()
    return {"ok": True, "deleted": count}


@router.get("/business-mappings/count")
def business_mappings_count() -> dict:
    if is_mock_mode():
        return {"count": 0}
    from src.db.connection import run_query
    df = run_query("SELECT COUNT(*) AS cnt FROM business_transaction_mappings")
    return {"count": int(df["cnt"].iloc[0])}


@router.delete("/business-mappings")
def reset_business_mappings() -> dict:
    if is_mock_mode():
        return {"ok": True, "deleted": 0}
    from src.db.connection import run_query
    df = run_query("SELECT COUNT(*) AS cnt FROM business_transaction_mappings")
    count = int(df["cnt"].iloc[0])
    execute_mutation("DELETE FROM business_transaction_mappings", {})
    _bust_category_caches()
    return {"ok": True, "deleted": count}


def _bust_category_caches() -> None:
    # Mapping changes ripple into transactions, hierarchies, and dashboards,
    # so evict everything rather than tracking individual dependent caches.
    from backend import cache as _cache_mod
    _cache_mod.clear_all()
