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
    # Bust the FastAPI TTL caches
    from backend import cache as _cache_mod
    _cache_mod._cache.pop("get_category_hierarchy", None)
    _cache_mod._cache.pop("get_uncategorized_descriptions", None)
    # Also bust the underlying @st.cache_data caches (active even outside Streamlit)
    from src.db.queries.transactions import get_all_transactions, get_uncategorized_transactions, get_uncategorized_descriptions as _get_uncategorized
    from src.db.queries.categories import get_all_categories, get_category_hierarchy as _get_hierarchy
    get_all_transactions.clear()
    get_uncategorized_transactions.clear()
    _get_uncategorized.clear()
    get_all_categories.clear()
    _get_hierarchy.clear()
    return {"ok": True}
