"""Business mapping REST endpoints."""

from fastapi import APIRouter, Query
from pydantic import BaseModel

from backend.cache import ttl_cached
from src.db.mutations.business import insert_business_description, insert_business_mapping
from src.db.queries.business import (
    get_all_business_descriptions,
    get_unmapped_business_descriptions,
    get_unmapped_transactions_for_description,
)

router = APIRouter(prefix="/business")

_descriptions = ttl_cached(get_all_business_descriptions)
_unmapped = ttl_cached(get_unmapped_business_descriptions)


@router.get("/descriptions")
def descriptions() -> list[dict]:
    df = _descriptions()
    return df.to_dict(orient="records")


@router.get("/unmapped")
def unmapped() -> list[dict]:
    df = _unmapped()
    return df.to_dict(orient="records")


@router.get("/transactions")
def transactions_for_description(description: str = Query(...)) -> list[dict]:
    df = get_unmapped_transactions_for_description(description)
    df = df.copy()
    df["activity_date"] = df["activity_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


class NewDescriptionPayload(BaseModel):
    description: str


@router.post("/description")
def create_description(payload: NewDescriptionPayload) -> dict:
    insert_business_description(payload.description)
    _bust_caches()
    df = _descriptions()
    row = df[df["description"] == payload.description]
    if len(row) == 0:
        return {"ok": True}
    rec = row.iloc[0].to_dict()
    return {"ok": True, "id": int(rec["id"]), "description": rec["description"]}


class MappingItem(BaseModel):
    unique_id: str
    business_descriptions_id: int


class MappingsPayload(BaseModel):
    mappings: list[MappingItem]


@router.post("/mappings")
def create_mappings(payload: MappingsPayload) -> dict:
    for item in payload.mappings:
        insert_business_mapping(item.unique_id, item.business_descriptions_id)
    _bust_caches()
    return {"ok": True, "saved": len(payload.mappings)}


def _bust_caches() -> None:
    from backend import cache as _cache_mod
    _cache_mod._cache.pop("get_all_business_descriptions", None)
    _cache_mod._cache.pop("get_unmapped_business_descriptions", None)
    get_all_business_descriptions.clear()
    get_unmapped_business_descriptions.clear()
