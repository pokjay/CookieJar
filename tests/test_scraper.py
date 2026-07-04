"""Tests for the scraper feature: unique_id derivation, mock-mode guards, and
the sync-start race-condition -> 409 mapping.
"""

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers import scraper as scraper_router  # noqa: E402
from backend.scraper_sync import transaction_unique_id  # noqa: E402
from src.db.mutations import scraper as scraper_mutations  # noqa: E402


def _fake_request() -> SimpleNamespace:
    return SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """_rate_limit is module-level shared state; clear it so one test's calls
    can't push another test over the 429 threshold."""
    scraper_router._rate_limit.clear()
    yield
    scraper_router._rate_limit.clear()


# ── transaction_unique_id() — must match moneyman's format exactly, since
#    ON CONFLICT (unique_id) DO NOTHING relies on it for dedup. ──────────────


def test_transaction_unique_id_basic():
    tx = {
        "date": "2026-06-01T00:00:00.000Z",
        "chargedAmount": -42.5,
        "identifier": "abc123",
    }
    assert transaction_unique_id(tx, "isracard", "1234") == "2026-06-01_isracard_1234_-42.5_abc123"


def test_transaction_unique_id_falls_back_to_description_and_memo():
    tx = {
        "date": "2026-06-01T00:00:00.000Z",
        "chargedAmount": 10,
        "description": "STARBUCKS",
        "memo": "coffee",
    }
    assert (
        transaction_unique_id(tx, "visaCal", "5678")
        == "2026-06-01_visaCal_5678_10_STARBUCKS_coffee"
    )


def test_transaction_unique_id_missing_fields_become_empty_strings():
    # No identifier/description/memo -> identifier falls back to "" + "_" + "" = "_",
    # so the final join has an extra "_" from that empty-but-present identifier part.
    tx = {"date": "2026-06-01T00:00:00.000Z"}
    assert transaction_unique_id(tx, "max", "9012") == "2026-06-01_max_9012___"


# ── src/db/mutations/scraper.py — every function must guard is_mock_mode()
#    itself and never touch the DB in mock mode. ─────────────────────────────


def test_insert_run_mock_mode_never_hits_db():
    with patch("src.db.mutations.scraper.execute_returning") as returning:
        run_id = scraper_mutations.insert_run(30)
    assert run_id == "mock-run-id"
    returning.assert_not_called()


def test_upsert_transactions_mock_mode_never_hits_db():
    with patch("src.db.mutations.scraper.execute_mutations_batch") as batch:
        count = scraper_mutations.upsert_transactions([{"unique_id": "x"}])
    assert count == 0
    batch.assert_not_called()


def test_mark_stale_runs_and_finish_run_mock_mode_never_hit_db():
    with patch("src.db.mutations.scraper.execute_mutation") as mutation:
        scraper_mutations.mark_stale_runs()
        scraper_mutations.finish_run("run-1", "success")
        scraper_mutations.insert_run_account("run-1", "1234", "isracard")
    mutation.assert_not_called()


# ── Race condition: has_running_run() + insert_run() is not atomic; the DB's
#    partial unique index is the real guard, surfaced as IntegrityError. ─────


def test_insert_run_translates_integrity_error_to_domain_error():
    with (
        patch("src.db.mutations.scraper.is_mock_mode", return_value=False),
        patch(
            "src.db.mutations.scraper.execute_returning",
            side_effect=IntegrityError("INSERT ...", {}, Exception("unique violation")),
        ),
    ):
        with pytest.raises(scraper_mutations.RunAlreadyRunningError):
            scraper_mutations.insert_run(30)


def test_sync_endpoint_maps_run_already_running_to_409():
    """Even if has_running_run() races past its pre-check, insert_run()'s
    IntegrityError -> RunAlreadyRunningError must still surface as a 409."""
    payload = scraper_router.SyncPayload(db_password="pw", lookback_days=7)
    with (
        patch.object(scraper_router, "is_mock_mode", return_value=False),
        patch.object(scraper_router, "has_running_run", return_value=False),
        patch.object(scraper_router, "get_credentials", return_value=[{"companyId": "isracard"}]),
        patch.object(
            scraper_router,
            "insert_run",
            side_effect=scraper_mutations.RunAlreadyRunningError("already running"),
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            scraper_router.scraper_sync(payload, BackgroundTasks(), _fake_request())
    assert exc_info.value.status_code == 409


def test_sync_endpoint_pre_check_returns_409_without_calling_insert_run():
    payload = scraper_router.SyncPayload(db_password="pw", lookback_days=7)
    with (
        patch.object(scraper_router, "is_mock_mode", return_value=False),
        patch.object(scraper_router, "has_running_run", return_value=True),
        patch.object(scraper_router, "insert_run") as insert_run,
    ):
        with pytest.raises(HTTPException) as exc_info:
            scraper_router.scraper_sync(payload, BackgroundTasks(), _fake_request())
    assert exc_info.value.status_code == 409
    insert_run.assert_not_called()


def test_sync_endpoint_unavailable_in_mock_mode():
    payload = scraper_router.SyncPayload(db_password="pw", lookback_days=7)
    with pytest.raises(HTTPException) as exc_info:
        scraper_router.scraper_sync(payload, BackgroundTasks(), _fake_request())
    assert exc_info.value.status_code == 503
