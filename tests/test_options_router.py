"""Tests for the stock-options router.

Mock-mode tests run by default; the integration tests at the bottom exercise
the real SQL against TEST_DATABASE_URL (see docs/TESTING.md).
"""

import os
from datetime import date

import pytest
from fastapi import HTTPException

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers import options as opt  # noqa: E402


def setup_function():
    opt.reset_mock_store()


def _body(**overrides) -> opt.GrantBody:
    fields = dict(
        name="Test grant",
        grant_date=date(2024, 1, 15),
        shares=1000,
        strike=5.5,
        vesting_years=4,
        cliff_months=12,
    )
    fields.update(overrides)
    return opt.GrantBody(**fields)


# ---------------------------------------------------------------------------
# Mock mode
# ---------------------------------------------------------------------------


def test_list_grants_returns_serializable_seed():
    grants = opt.list_grants()
    assert len(grants) == 4
    for g in grants:
        assert isinstance(g["id"], int)
        assert isinstance(g["shares"], float)
        assert isinstance(g["cliff_months"], int)
        # ISO date string, not a date/Timestamp object
        assert isinstance(g["grant_date"], str) and len(g["grant_date"]) == 10


def test_create_grant_assigns_new_id_and_appears_in_listing():
    existing_ids = {g["id"] for g in opt.list_grants()}
    created = opt.create_grant(_body())
    assert created["id"] not in existing_ids
    assert created["grant_date"] == "2024-01-15"
    assert any(g["id"] == created["id"] for g in opt.list_grants())


def test_update_grant_replaces_fields():
    gid = opt.list_grants()[0]["id"]
    updated = opt.update_grant(gid, _body(name="  Renamed  ", strike=9.25, grant_date=None))
    assert updated["name"] == "Renamed"  # whitespace stripped
    assert updated["strike"] == 9.25
    assert updated["grant_date"] is None
    assert next(g for g in opt.list_grants() if g["id"] == gid) == updated


def test_delete_grant_removes_it():
    gid = opt.list_grants()[0]["id"]
    assert opt.delete_grant(gid) == {"ok": True}
    assert all(g["id"] != gid for g in opt.list_grants())


@pytest.mark.parametrize("call", ["update", "delete"])
def test_unknown_grant_is_404(call):
    with pytest.raises(HTTPException) as exc:
        if call == "update":
            opt.update_grant(99999, _body())
        else:
            opt.delete_grant(99999)
    assert exc.value.status_code == 404


def test_rejects_invalid_values():
    with pytest.raises(ValueError):
        _body(shares=-1)
    with pytest.raises(ValueError):
        _body(vesting_years=0)


def test_grants_do_not_change_net_worth():
    """Options are view-only: adding a grant must not move the overview totals."""
    from backend.routers.overview import summary

    before = summary()["total"]
    opt.create_grant(_body(shares=1_000_000, strike=0.01))
    assert summary()["total"] == before


# ---------------------------------------------------------------------------
# Integration (real DB)
# ---------------------------------------------------------------------------


@pytest.fixture
def real_db(migrated_db, monkeypatch):
    url = migrated_db.url.render_as_string(hide_password=False)
    if "options=" not in url:
        url = f"{url}?options=-csearch_path%3Dmoneyman"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("USE_MOCK_DATA", "false")

    import src.db.connection as conn_mod

    monkeypatch.setattr(conn_mod, "_engine", None)
    yield migrated_db
    with migrated_db.begin() as conn:
        conn.exec_driver_sql("TRUNCATE moneyman.option_grants RESTART IDENTITY")


@pytest.mark.integration
def test_db_crud_round_trip(real_db):
    assert opt.list_grants() == []

    created = opt.create_grant(_body())
    assert created == {
        "id": created["id"],
        "name": "Test grant",
        "grant_date": "2024-01-15",
        "shares": 1000.0,
        "strike": 5.5,
        "vesting_years": 4.0,
        "cliff_months": 12,
    }

    updated = opt.update_grant(created["id"], _body(name="Refresh", shares=250.5))
    assert updated["name"] == "Refresh"
    assert updated["shares"] == 250.5
    assert opt.list_grants() == [updated]

    assert opt.delete_grant(created["id"]) == {"ok": True}
    assert opt.list_grants() == []


@pytest.mark.integration
def test_db_unknown_grant_is_404(real_db):
    with pytest.raises(HTTPException) as exc:
        opt.update_grant(424242, _body())
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        opt.delete_grant(424242)
    assert exc.value.status_code == 404


@pytest.mark.integration
def test_db_lists_oldest_grant_first_and_undated_last(real_db):
    opt.create_grant(_body(name="Newer", grant_date=date(2025, 6, 1)))
    opt.create_grant(_body(name="Undated", grant_date=None))
    opt.create_grant(_body(name="Older", grant_date=date(2021, 2, 1)))
    assert [g["name"] for g in opt.list_grants()] == ["Older", "Newer", "Undated"]
