"""Stock option grants REST endpoints (Options explorer page).

Grants live in their own table and are intentionally NOT part of net worth:
the overview / net-worth queries only read investment_accounts(_tracking), so
nothing stored here changes the household totals. The page is a standalone
"what are my grants worth at price X" explorer. Only the grants are stored: the
assumed share price is an exploration input kept in the browser, and the 409A
shown is derived client-side from the latest grant's strike.
"""

import math
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from src.db.connection import is_mock_mode
from src.db.mutations.options import (
    delete_option_grant,
    insert_option_grant,
    update_option_grant,
)
from src.db.queries.options import get_option_grants

router = APIRouter(prefix="/options")

# Mock-mode store, seeded lazily from mock_data on first use.
_mock_grants: Optional[list[dict]] = None


class GrantBody(BaseModel):
    name: str = ""
    grant_date: Optional[date] = None
    shares: float = Field(default=0, ge=0)
    strike: float = Field(default=0, ge=0)
    vesting_years: float = Field(default=4, gt=0)
    cliff_months: int = Field(default=12, ge=0)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v


def _num(v, cast=float, default=0):
    if v is None:
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(f) else cast(f)


def _iso(v) -> Optional[str]:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if hasattr(v, "isoformat"):
        # pandas Timestamp / datetime → keep the date part only
        return (v.date() if hasattr(v, "date") and callable(v.date) else v).isoformat()
    return str(v) or None


def _serialize(row: dict) -> dict:
    return {
        "id": int(row["id"]),
        "name": row.get("name") or "",
        "grant_date": _iso(row.get("grant_date")),
        "shares": _num(row.get("shares")),
        "strike": _num(row.get("strike")),
        "vesting_years": _num(row.get("vesting_years"), default=4),
        "cliff_months": _num(row.get("cliff_months"), cast=int, default=0),
    }


def _mock_store() -> list[dict]:
    global _mock_grants
    if _mock_grants is None:
        _mock_grants = [_serialize(r) for r in get_option_grants().to_dict("records")]
    return _mock_grants


def reset_mock_store() -> None:
    """Drop in-memory mock edits (used by tests)."""
    global _mock_grants
    _mock_grants = None


@router.get("/grants")
def list_grants() -> list[dict]:
    if is_mock_mode():
        return list(_mock_store())
    return [_serialize(r) for r in get_option_grants().to_dict("records")]


@router.post("/grants", status_code=201)
def create_grant(body: GrantBody) -> dict:
    if is_mock_mode():
        store = _mock_store()
        new_id = max((g["id"] for g in store), default=0) + 1
        record = _serialize({"id": new_id, **body.model_dump()})
        store.append(record)
        return record
    return _serialize(insert_option_grant(body.model_dump()))


@router.put("/grants/{grant_id}")
def update_grant(grant_id: int, body: GrantBody) -> dict:
    if is_mock_mode():
        store = _mock_store()
        for i, g in enumerate(store):
            if g["id"] == grant_id:
                store[i] = _serialize({"id": grant_id, **body.model_dump()})
                return store[i]
        raise HTTPException(status_code=404, detail="Grant not found")
    updated = update_option_grant(grant_id, body.model_dump())
    if updated is None:
        raise HTTPException(status_code=404, detail="Grant not found")
    return _serialize(updated)


@router.delete("/grants/{grant_id}")
def delete_grant(grant_id: int) -> dict:
    if is_mock_mode():
        store = _mock_store()
        before = len(store)
        store[:] = [g for g in store if g["id"] != grant_id]
        if len(store) == before:
            raise HTTPException(status_code=404, detail="Grant not found")
        return {"ok": True}
    if not delete_option_grant(grant_id):
        raise HTTPException(status_code=404, detail="Grant not found")
    return {"ok": True}
