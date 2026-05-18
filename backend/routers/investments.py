"""Investment accounts REST endpoints."""

import math
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel

from backend.data import get_investment_accounts_with_latest
from src.constants import ACCOUNT_TYPE_MAP
from src.db.connection import execute_mutation, is_mock_mode

router = APIRouter(prefix="/investments")

# In-memory mock stores for write operations
_mock_new_accounts: list[dict] = []
_mock_balance_overrides: dict[int, dict] = {}


class CreateAccountBody(BaseModel):
    person: str
    company: str
    account_type: str
    account_type_category: Optional[str] = None
    is_active: bool = True
    is_pension: bool = False
    deposit_management_fees: Optional[float] = None
    acc_management_fees: Optional[float] = None
    investment_track: Optional[str] = None
    monthly_deposit: Optional[float] = None
    account_number: Optional[str] = None


class UpsertBalanceBody(BaseModel):
    amount: float
    date: date


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _safe_date(v) -> Optional[str]:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            return None
    return str(v) if v else None


def _row_to_dict(row: pd.Series) -> dict:
    account_type = row.get("account_type", "") or ""
    return {
        "id": int(row["id"]),
        "person": row["person"],
        "company": row["company"],
        "account_type": account_type,
        "account_type_en": ACCOUNT_TYPE_MAP.get(account_type, account_type),
        "account_type_category": row.get("account_type_category"),
        "is_active": bool(row.get("is_active", True)),
        "is_pension": bool(row.get("is_pension", False)),
        "deposit_management_fees": _safe_float(row.get("deposit_management_fees")),
        "acc_management_fees": _safe_float(row.get("acc_management_fees")),
        "investment_track": row.get("investment_track"),
        "monthly_deposit": _safe_float(row.get("monthly_deposit")),
        "account_number": row.get("account_number"),
        "latest_amount": _safe_float(row.get("latest_amount")),
        "last_updated": _safe_date(row.get("latest_date")),
    }


@router.get("/accounts")
def list_accounts():
    df = get_investment_accounts_with_latest()
    records = [_row_to_dict(row) for _, row in df.iterrows()]

    # In mock mode, apply any in-session balance overrides
    if is_mock_mode():
        for record in records:
            override = _mock_balance_overrides.get(record["id"])
            if override:
                record["latest_amount"] = override["amount"]
                record["last_updated"] = override["date"]
        records.extend(_mock_new_accounts)

    return records


@router.post("/accounts", status_code=201)
def create_account(body: CreateAccountBody):
    if is_mock_mode():
        new_id = 1000 + len(_mock_new_accounts)
        account_type = body.account_type
        new = {
            "id": new_id,
            "account_type_en": ACCOUNT_TYPE_MAP.get(account_type, account_type),
            "latest_amount": None,
            "last_updated": None,
            **body.model_dump(),
        }
        _mock_new_accounts.append(new)
        return new

    execute_mutation(
        """
        INSERT INTO investment_accounts (
            person, company, account_type, account_type_category,
            is_active, is_pension, deposit_management_fees, acc_management_fees,
            investment_track, monthly_deposit, account_number
        ) VALUES (
            :person, :company, :account_type, :account_type_category,
            :is_active, :is_pension, :deposit_management_fees, :acc_management_fees,
            :investment_track, :monthly_deposit, :account_number
        )
        """,
        body.model_dump(),
    )
    return {"ok": True}


@router.post("/accounts/{account_id}/balance")
def upsert_balance(account_id: int, body: UpsertBalanceBody):
    if is_mock_mode():
        _mock_balance_overrides[account_id] = {
            "amount": body.amount,
            "date": body.date.isoformat(),
        }
        return {"ok": True}

    execute_mutation(
        """
        WITH updated AS (
            UPDATE investment_accounts_tracking
            SET amount = :amount
            WHERE investment_accounts_id = :account_id AND activity_date = :date
            RETURNING id
        )
        INSERT INTO investment_accounts_tracking (investment_accounts_id, activity_date, amount)
        SELECT :account_id, :date, :amount
        WHERE NOT EXISTS (SELECT 1 FROM updated)
        """,
        {"account_id": account_id, "date": body.date, "amount": body.amount},
    )
    return {"ok": True}
