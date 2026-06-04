"""Category mapping REST endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

from backend.cache import ttl_cached
from src.db.mutations.categories import insert_category_mapping
from src.db.queries.categories import get_category_hierarchy
from src.db.queries.transactions import get_uncategorized_descriptions

router = APIRouter(prefix="/categories")

_hierarchy = ttl_cached(get_category_hierarchy)
_uncategorized = ttl_cached(get_uncategorized_descriptions)


@router.get("/hierarchy")
def hierarchy() -> dict[str, list[str]]:
    return _hierarchy()


@router.get("/uncategorized")
def uncategorized() -> list[dict]:
    df = _uncategorized()
    df = df.copy()
    df["last_date"] = df["last_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


class MappingPayload(BaseModel):
    description: str
    category: str
    subcategory: str


@router.post("/mapping")
def create_mapping(payload: MappingPayload) -> dict:
    insert_category_mapping(payload.description, payload.category, payload.subcategory)
    from backend import cache as _cache_mod
    _cache_mod.clear_all()
    return {"ok": True}
