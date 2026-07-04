"""Tests for the scraper feature: unique_id derivation, mock-mode guards, the
sync-start race-condition -> 409 mapping, and run_sync's account-number
selection, timezone handling, and run-finishing guarantees.
"""

import os
from contextlib import ExitStack
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers import scraper as scraper_router  # noqa: E402
from backend.scraper_sync import (  # noqa: E402
    _build_transaction_row,
    run_sync,
    transaction_unique_id,
)
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


def test_transaction_unique_id_converts_utc_to_local_date():
    """21:00 UTC the previous day is local midnight in the default Asia/Jerusalem
    zone (UTC+3 in summer) - the date part must reflect the local day, matching
    moneyman's local-time yyyy-MM-dd, not the raw UTC day."""
    tx = {"date": "2026-05-31T21:00:00.000Z", "chargedAmount": 5, "identifier": "x"}
    assert transaction_unique_id(tx, "isracard", "1234") == "2026-06-01_isracard_1234_5_x"


def test_build_transaction_row_activity_date_matches_unique_id_local_date():
    """unique_id and activity_date must derive from the same converted date so
    they can never disagree."""
    tx = {"date": "2026-05-31T21:00:00.000Z", "chargedAmount": 5, "identifier": "x"}
    row = _build_transaction_row(tx, "isracard", "1234")
    assert row["activity_date"] == date(2026, 6, 1)
    assert row["unique_id"] == "2026-06-01_isracard_1234_5_x"


def test_transaction_unique_id_unparseable_date_keeps_string_fallback():
    tx = {"date": "not-a-date", "chargedAmount": 1, "identifier": "x"}
    assert transaction_unique_id(tx, "isracard", "1234") == "not-a-date_isracard_1234_1_x"


def test_transaction_unique_id_naive_datetime_keeps_string_fallback():
    """A naive datetime has no offset to convert from, so it falls back to the
    raw string just like an unparseable one - it isn't truncated as UTC."""
    tx = {"date": "2026-06-01T00:00:00", "chargedAmount": 1, "identifier": "x"}
    assert transaction_unique_id(tx, "isracard", "1234") == "2026-06-01T00:00:00_isracard_1234_1_x"


def test_build_transaction_row_naive_datetime_activity_date_is_raw_string():
    tx = {"date": "2026-06-01T00:00:00", "chargedAmount": 1, "identifier": "x"}
    row = _build_transaction_row(tx, "isracard", "1234")
    assert row["activity_date"] == "2026-06-01T00:00:00"


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


# ── run_sync() — per-tx accountNumber selection, and the try/finally
#    guarantee that a run is always finished. ────────────────────────────────


def _run_sync_mocks(scrape_result, upsert_side_effect=None) -> ExitStack:
    """Patch every DB/HTTP-touching name run_sync imports directly, so tests
    can drive it without a real scraper sidecar or database."""
    stack = ExitStack()
    stack.enter_context(patch("backend.scraper_sync.is_mock_mode", return_value=False))
    stack.enter_context(patch("backend.scraper_sync.insert_run_account"))
    stack.enter_context(patch("backend.scraper_sync.finish_run_account"))
    stack.enter_context(patch("backend.scraper_sync.finish_run"))
    stack.enter_context(patch("backend.scraper_sync.clear_all"))
    stack.enter_context(patch("backend.scraper_sync._scrape_account", return_value=scrape_result))
    stack.enter_context(
        patch("backend.scraper_sync.upsert_transactions", side_effect=upsert_side_effect)
    )
    return stack


def test_run_sync_uses_each_transactions_own_account_number():
    """Sub-accounts under one credential each carry their own accountNumber
    (stamped per-tx by the sidecar); a tx with one must use it, not the
    top-level accountNumber (which is only the first sub-account's)."""
    result = {
        "errorType": None,
        "accountNumber": "1111",
        "transactions": [
            {"date": "2026-06-01T00:00:00.000Z", "chargedAmount": 1, "accountNumber": "2222"},
        ],
    }
    captured = {}

    def fake_upsert(rows):
        captured["rows"] = rows
        return len(rows)

    with _run_sync_mocks(result, fake_upsert):
        run_sync([{"companyId": "isracard", "accountTitle": "My Isracard"}], "run-1", 30)

    assert captured["rows"][0]["account"] == "2222"


def test_run_sync_falls_back_to_top_level_account_number():
    """A tx missing its own accountNumber falls back to the result's top-level
    accountNumber (the first sub-account's)."""
    result = {
        "errorType": None,
        "accountNumber": "1111",
        "transactions": [{"date": "2026-06-01T00:00:00.000Z", "chargedAmount": 1}],
    }
    captured = {}

    def fake_upsert(rows):
        captured["rows"] = rows
        return len(rows)

    with _run_sync_mocks(result, fake_upsert):
        run_sync([{"companyId": "isracard", "accountTitle": "My Isracard"}], "run-1", 30)

    assert captured["rows"][0]["account"] == "1111"


def test_run_sync_falls_back_to_account_title_when_no_account_number_anywhere():
    """With neither a per-tx nor a top-level accountNumber, fall back to the
    credential's accountTitle - same as the pre-fix default."""
    result = {
        "errorType": None,
        "accountNumber": None,
        "transactions": [{"date": "2026-06-01T00:00:00.000Z", "chargedAmount": 1}],
    }
    captured = {}

    def fake_upsert(rows):
        captured["rows"] = rows
        return len(rows)

    with _run_sync_mocks(result, fake_upsert):
        run_sync([{"companyId": "isracard", "accountTitle": "My Isracard"}], "run-1", 30)

    assert captured["rows"][0]["account"] == "My Isracard"


def test_run_sync_finishes_run_as_error_on_unexpected_exception():
    """insert_run_account raising (outside the per-account try/excepts) must
    not leave the run stuck 'running' forever - it should still be finished,
    as 'error', and the cache still cleared."""
    with (
        patch("backend.scraper_sync.is_mock_mode", return_value=False),
        patch(
            "backend.scraper_sync.insert_run_account",
            side_effect=RuntimeError("boom"),
        ),
        patch("backend.scraper_sync.finish_run") as finish_run_mock,
        patch("backend.scraper_sync.clear_all") as clear_all_mock,
    ):
        run_sync([{"companyId": "isracard", "accountTitle": "My Isracard"}], "run-1", 30)

    finish_run_mock.assert_called_once_with("run-1", "error")
    clear_all_mock.assert_called_once()
