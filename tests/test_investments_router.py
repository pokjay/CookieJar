"""Tests for the investments router (mock-mode, no DB required)."""

import os
from datetime import date

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers import investments as inv  # noqa: E402


def setup_function():
    inv._mock_new_accounts.clear()
    inv._mock_balance_overrides.clear()


def test_list_accounts_returns_serializable_records():
    records = inv.list_accounts()
    assert len(records) > 0
    for r in records:
        assert isinstance(r["id"], int)
        assert r["person"] in ("Gomez", "Morticia")
        # NaN must already be scrubbed to None for JSON serialization
        assert r["latest_amount"] is None or r["latest_amount"] == r["latest_amount"]


def test_create_account_appears_in_listing():
    created = inv.create_account(
        inv.CreateAccountBody(person="Gomez", company="TestCo", account_type="Stocks")
    )
    assert created["person"] == "Gomez"
    listed = inv.list_accounts()
    assert any(r["id"] == created["id"] for r in listed)


def test_upsert_balance_overrides_listing():
    account_id = inv.list_accounts()[0]["id"]
    result = inv.upsert_balance(account_id, inv.UpsertBalanceBody(amount=1234.5, date=date(2025, 1, 31)))
    assert result == {"ok": True}
    record = next(r for r in inv.list_accounts() if r["id"] == account_id)
    assert record["latest_amount"] == 1234.5
    assert record["last_updated"] == "2025-01-31"
