"""Manual Transactions REST endpoints."""

import uuid
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from src.db.connection import get_enum_values, is_mock_mode
from src.db.mutations.transactions import insert_manual_transaction, insert_manual_transactions
from src.db.queries.transactions import get_existing_transaction_keys

router = APIRouter(prefix="/manual-transactions")

CURRENCIES = ["ILS", "USD", "EUR", "GBP"]
_FALLBACK_CASH_FLOW_TYPES = ["salary", "other_income", "expense", "savings", "internal_transfer"]


def _get_cash_flow_types() -> list[str]:
    if is_mock_mode():
        return _FALLBACK_CASH_FLOW_TYPES
    return get_enum_values("cash_flow_type")


@router.get("/meta")
def get_meta() -> dict:
    return {
        "currencies": CURRENCIES,
        "cash_flow_types": _get_cash_flow_types(),
    }


class SingleTransactionPayload(BaseModel):
    unique_id: str | None = None
    account: str
    activity_date: date
    charged_amount: float | None = None
    charged_currency: str
    original_amount: float
    original_currency: str
    description: str
    identifier: str | None = None
    additional_info: str | None = None
    charged_date: date | None = None
    cash_flow_type: str = "expense"

    @field_validator("account", "description", mode="before")
    @classmethod
    def strip_str(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v


@router.post("/check-duplicate")
def check_duplicate(payload: SingleTransactionPayload) -> dict:
    if is_mock_mode():
        return {"is_duplicate": False}
    keys = get_existing_transaction_keys()
    effective_charged = payload.charged_amount if payload.charged_amount is not None else payload.original_amount
    key = (payload.activity_date, payload.account, effective_charged, payload.description)
    return {"is_duplicate": key in keys}


@router.post("/single")
def create_single(payload: SingleTransactionPayload) -> dict:
    effective_charged = payload.charged_amount if payload.charged_amount is not None else payload.original_amount
    row = {
        "unique_id": payload.unique_id or str(uuid.uuid4()),
        "account": payload.account,
        "activity_date": payload.activity_date,
        "charged_amount": effective_charged,
        "charged_currency": payload.charged_currency,
        "original_amount": payload.original_amount,
        "original_currency": payload.original_currency,
        "description": payload.description,
        "identifier": payload.identifier or None,
        "additional_info": payload.additional_info or None,
        "charged_date": payload.charged_date,
        "cash_flow_type": payload.cash_flow_type,
    }
    insert_manual_transaction(row)
    _bust_caches()
    return {"ok": True}


class BulkRow(BaseModel):
    unique_id: str | None = None
    account: str
    activity_date: str
    charged_amount: float | None = None
    charged_currency: str
    original_amount: float
    original_currency: str
    description: str
    identifier: str | None = None
    additional_info: str | None = None
    charged_date: str | None = None
    cash_flow_type: str = "expense"


class BulkImportPayload(BaseModel):
    rows: list[BulkRow]


@router.post("/bulk")
def bulk_import(payload: BulkImportPayload) -> dict:
    cash_flow_types = _get_cash_flow_types()
    rows_to_insert = []
    for r in payload.rows:
        try:
            activity_date = _parse_date(r.activity_date)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=f"Invalid activity_date: {e}") from e

        charged_date = None
        if r.charged_date:
            try:
                charged_date = _parse_date(r.charged_date)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=f"Invalid charged_date: {e}") from e

        effective_charged = r.charged_amount if r.charged_amount is not None else r.original_amount
        cft = r.cash_flow_type if r.cash_flow_type in cash_flow_types else "expense"

        rows_to_insert.append({
            "unique_id": r.unique_id or str(uuid.uuid4()),
            "account": r.account,
            "activity_date": activity_date,
            "charged_amount": effective_charged,
            "charged_currency": r.charged_currency,
            "original_amount": r.original_amount,
            "original_currency": r.original_currency,
            "description": r.description,
            "identifier": r.identifier or None,
            "additional_info": r.additional_info or None,
            "charged_date": charged_date,
            "cash_flow_type": cft,
        })

    insert_manual_transactions(rows_to_insert)
    _bust_caches()
    return {"ok": True, "imported": len(rows_to_insert)}


def _parse_date(value: str) -> date:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {value!r}")


def _bust_caches() -> None:
    from backend.cache import clear_all
    clear_all()
