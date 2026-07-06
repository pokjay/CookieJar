"""Integration tests for the scraper feature against a real PostgreSQL instance.

Unit tests in test_scraper.py mock every DB call, so they can't catch a class
of bug where a mock doesn't reflect what actually happens against a live
connection. Concretely: insert_run() originally used run_query() — a bare
engine.connect(), meant for read-only SELECTs — to run an INSERT ...
RETURNING. The row was visible to that same connection during the call (so a
valid-looking run_id came back, no error raised) but never committed, and
rolled back the instant the connection closed. Every unit test mocking
execute_returning() would still pass against that bug; only a real database
round-trip catches it. These tests exercise that round trip for the write
path (insert_run, upsert_transactions) and the two query functions
(has_running_run, get_last_run) that read back what those writes produced.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

pytestmark = pytest.mark.integration


@pytest.fixture
def scraper_db(migrated_db, monkeypatch):
    """Point src.db.connection at the integration DB for this test, and clean
    up scraper/transactions rows afterward so tests don't see each other's
    leftover state on the shared session-scoped database."""
    url = migrated_db.url.render_as_string(hide_password=False)
    if "options=" not in url:
        url = f"{url}?options=-csearch_path%3Dmoneyman"

    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("USE_MOCK_DATA", "false")

    import src.db.connection as conn_mod

    monkeypatch.setattr(conn_mod, "_engine", None)

    yield migrated_db

    with migrated_db.begin() as conn:
        conn.exec_driver_sql("DELETE FROM scraper_run_accounts")
        conn.exec_driver_sql("DELETE FROM scraper_runs")
        conn.exec_driver_sql("DELETE FROM transactions")


def test_insert_run_actually_commits(scraper_db):
    """Regression test for the run_query()-doesn't-commit bug: insert_run()'s
    row must survive after the connection that created it is closed, visible
    to a brand new connection — not just readable within the same one."""
    from src.db.mutations.scraper import insert_run

    run_id = insert_run(lookback_days=14)
    assert run_id != "mock-run-id"

    with scraper_db.connect() as fresh_conn:
        row = fresh_conn.execute(
            sa.text("SELECT status, lookback_days FROM scraper_runs WHERE id = :id"),
            {"id": run_id},
        ).one()
    assert row.status == "running"
    assert row.lookback_days == 14


def test_has_running_run_reflects_real_state(scraper_db):
    from src.db.mutations.scraper import finish_run, insert_run
    from src.db.queries.scraper import has_running_run

    assert has_running_run() is False

    run_id = insert_run(lookback_days=7)
    assert has_running_run() is True

    finish_run(run_id, "success")
    assert has_running_run() is False


def test_get_last_run_returns_run_with_its_accounts(scraper_db):
    from src.db.mutations.scraper import (
        finish_run,
        finish_run_account,
        insert_run,
        insert_run_account,
    )
    from src.db.queries.scraper import get_last_run

    run_id = insert_run(lookback_days=30)
    insert_run_account(run_id, account="1234", company_id="isracard")
    finish_run_account(run_id, "1234", "isracard", "success", None, 5)
    finish_run(run_id, "success")

    last_run = get_last_run()
    assert last_run is not None
    assert last_run["status"] == "success"
    assert last_run["lookback_days"] == 30
    assert len(last_run["accounts"]) == 1
    assert last_run["accounts"][0]["account"] == "1234"
    assert last_run["accounts"][0]["transactions_imported"] == 5


def test_second_insert_run_while_one_running_raises_domain_error(scraper_db):
    """The DB's partial unique index (scraper_runs_one_running) is the real
    guard against the has_running_run()+insert_run() race — this hits the
    actual constraint, not a mocked IntegrityError."""
    from src.db.mutations.scraper import RunAlreadyRunningError, insert_run

    insert_run(lookback_days=7)
    with pytest.raises(RunAlreadyRunningError):
        insert_run(lookback_days=7)


def test_upsert_transactions_dedupes_on_conflict(scraper_db):
    """Re-syncing an overlapping window must not duplicate rows, and the
    returned count must reflect only genuinely new inserts."""
    from src.db.mutations.scraper import upsert_transactions

    row = {
        "unique_id": "2026-06-01_isracard_1234_10_abc",
        "company_id": "isracard",
        "account": "1234",
        "status": "completed",
        "activity_date": "2026-06-01",
        "charged_amount": 10,
        "charged_currency": "ILS",
        "original_amount": 10,
        "original_currency": "ILS",
        "description": "STARBUCKS",
        "memo": None,
        "identifier": "abc",
        "installments": None,
        "raw": '{"description": "STARBUCKS"}',
    }

    first = upsert_transactions([row])
    assert first == 1

    second = upsert_transactions([row])
    assert second == 0

    with scraper_db.connect() as fresh_conn:
        count = fresh_conn.execute(
            sa.text("SELECT count(*) FROM transactions WHERE unique_id = :uid"),
            {"uid": row["unique_id"]},
        ).scalar_one()
    assert count == 1
