"""Tests for the scraper router's rate limiter and stale-run recovery.

Covers findings from PR review:
 - the limiter only trips on FAILED vault-password attempts, never on
   successful calls (so a normal add/edit/delete + list-refresh sequence
   never 429s mid-setup);
 - X-Forwarded-For (set by the Next.js proxy) is used as the bucket key
   when present, instead of the shared proxy IP;
 - /sync clears stale 'running' rows via mark_stale_runs() before checking
   has_running_run(), so a stuck run doesn't require a backend restart.
"""

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import BackgroundTasks, HTTPException
from pykeepass.exceptions import CredentialsError

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers import scraper as scraper_router  # noqa: E402


def _fake_request(ip: str = "127.0.0.1", forwarded_for: str | None = None) -> SimpleNamespace:
    headers: dict[str, str] = {}
    if forwarded_for is not None:
        headers["x-forwarded-for"] = forwarded_for
    return SimpleNamespace(client=SimpleNamespace(host=ip), headers=headers)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """_rate_limit is module-level shared state; clear it so one test's calls
    can't push another test over the 429 threshold."""
    scraper_router._rate_limit.clear()
    yield
    scraper_router._rate_limit.clear()


# ── Correct password never trips the limiter ────────────────────────────────


def test_correct_password_calls_never_trip_the_limiter():
    request = _fake_request()
    payload = scraper_router.ListPayload(db_password="correct-horse")
    with patch.object(scraper_router, "list_accounts", return_value=[]):
        for _ in range(20):
            result = scraper_router.scraper_list_accounts(payload, request)
    assert result == []
    # No failures were ever recorded, so the bucket stays empty.
    assert scraper_router._rate_limit == {}


def test_check_rate_limit_alone_does_not_grow_the_bucket():
    request = _fake_request()
    for _ in range(50):
        scraper_router._check_rate_limit(request)
    assert scraper_router._rate_limit == {}


# ── Failed attempts do trip the limiter ──────────────────────────────────────


def test_six_failed_password_attempts_from_one_client_trip_429():
    request = _fake_request(ip="10.0.0.5")
    payload = scraper_router.ListPayload(db_password="wrong")
    with patch.object(scraper_router, "list_accounts", side_effect=CredentialsError()):
        for _ in range(5):
            with pytest.raises(HTTPException) as exc_info:
                scraper_router.scraper_list_accounts(payload, request)
            assert exc_info.value.status_code == 401

        # 6th attempt: the limiter itself should now reject before even
        # trying the (still-wrong) password.
        with pytest.raises(HTTPException) as exc_info:
            scraper_router.scraper_list_accounts(payload, request)
        assert exc_info.value.status_code == 429


def test_successful_call_after_failures_is_not_blocked_but_does_not_clear_bucket():
    """A correct password doesn't add to the bucket, but also doesn't erase
    prior recorded failures — only time (the 60s window) does."""
    request = _fake_request(ip="10.0.0.9")
    bad_payload = scraper_router.ListPayload(db_password="wrong")
    good_payload = scraper_router.ListPayload(db_password="right")

    with patch.object(scraper_router, "list_accounts", side_effect=CredentialsError()):
        for _ in range(4):
            with pytest.raises(HTTPException):
                scraper_router.scraper_list_accounts(bad_payload, request)

    with patch.object(scraper_router, "list_accounts", return_value=[]):
        # Still under the limit (4 failures), so this succeeds.
        assert scraper_router.scraper_list_accounts(good_payload, request) == []

    assert len(scraper_router._rate_limit["10.0.0.9"]) == 4


# ── X-Forwarded-For is used as the bucket key ────────────────────────────────


def test_x_forwarded_for_is_used_as_the_bucket_key_when_present():
    request = _fake_request(ip="172.18.0.2", forwarded_for="203.0.113.7, 172.18.0.2")
    assert scraper_router._client_ip(request) == "203.0.113.7"


def test_falls_back_to_client_host_without_x_forwarded_for():
    request = _fake_request(ip="172.18.0.2")
    assert scraper_router._client_ip(request) == "172.18.0.2"


def test_distinct_forwarded_ips_get_separate_buckets():
    """Two browser users behind the same proxy container must not share one
    bucket — each X-Forwarded-For value gets its own budget."""
    payload = scraper_router.ListPayload(db_password="wrong")
    with patch.object(scraper_router, "list_accounts", side_effect=CredentialsError()):
        for _ in range(5):
            with pytest.raises(HTTPException):
                scraper_router.scraper_list_accounts(
                    payload, _fake_request(forwarded_for="1.1.1.1")
                )
        # A different real client (same proxy IP, different X-Forwarded-For)
        # is unaffected.
        with pytest.raises(HTTPException) as exc_info:
            scraper_router.scraper_list_accounts(payload, _fake_request(forwarded_for="2.2.2.2"))
        assert exc_info.value.status_code == 401  # not 429


def test_rotating_x_forwarded_for_cannot_bypass_the_global_backstop():
    """X-Forwarded-For is client-influenced, so an attacker can rotate it to
    land every failed attempt in a fresh bucket. The global cap across all
    buckets must still stop the brute force."""
    payload = scraper_router.ListPayload(db_password="wrong")
    with patch.object(scraper_router, "list_accounts", side_effect=CredentialsError()):
        for i in range(scraper_router._RATE_MAX_GLOBAL):
            with pytest.raises(HTTPException) as exc_info:
                scraper_router.scraper_list_accounts(
                    payload, _fake_request(forwarded_for=f"6.6.6.{i}")
                )
            assert exc_info.value.status_code == 401

        # Next attempt from yet another spoofed IP: global backstop trips.
        with pytest.raises(HTTPException) as exc_info:
            scraper_router.scraper_list_accounts(payload, _fake_request(forwarded_for="6.6.99.99"))
        assert exc_info.value.status_code == 429


# ── /sync clears stale runs before checking has_running_run() ──────────────


def test_sync_calls_mark_stale_runs_before_checking_running():
    payload = scraper_router.SyncPayload(db_password="pw", lookback_days=7)
    call_order: list[str] = []

    def _mark_stale_runs():
        call_order.append("mark_stale_runs")

    def _has_running_run():
        call_order.append("has_running_run")
        return True

    with (
        patch.object(scraper_router, "is_mock_mode", return_value=False),
        patch.object(scraper_router, "mark_stale_runs", side_effect=_mark_stale_runs),
        patch.object(scraper_router, "has_running_run", side_effect=_has_running_run),
    ):
        with pytest.raises(HTTPException) as exc_info:
            scraper_router.scraper_sync(payload, BackgroundTasks(), _fake_request())

    assert exc_info.value.status_code == 409
    assert call_order == ["mark_stale_runs", "has_running_run"]


def test_sync_stale_run_cleared_lets_a_new_sync_start():
    """If mark_stale_runs() clears the stuck row, has_running_run() should
    now see no running run and the sync should proceed instead of 409ing."""
    payload = scraper_router.SyncPayload(db_password="pw", lookback_days=7)
    with (
        patch.object(scraper_router, "is_mock_mode", return_value=False),
        patch.object(scraper_router, "mark_stale_runs") as mark_stale_runs,
        patch.object(scraper_router, "has_running_run", return_value=False),
        patch.object(scraper_router, "get_credentials", return_value=[{"companyId": "isracard"}]),
        patch.object(scraper_router, "insert_run", return_value="run-123"),
    ):
        result = scraper_router.scraper_sync(payload, BackgroundTasks(), _fake_request())

    mark_stale_runs.assert_called_once()
    assert result == {"run_id": "run-123"}
