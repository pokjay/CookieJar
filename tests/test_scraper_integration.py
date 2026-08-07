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


def _txn_row(**overrides):
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
        "bank_category": None,
    }
    row.update(overrides)
    return row


def _stored(engine, unique_id):
    with engine.connect() as fresh_conn:
        return fresh_conn.execute(
            sa.text(
                "SELECT raw, memo, bank_category, updated_at "
                "FROM transactions WHERE unique_id = :uid"
            ),
            {"uid": unique_id},
        ).one()


def test_upsert_transactions_dedupes_on_conflict(scraper_db):
    """Re-syncing an overlapping window must not duplicate rows, and the
    returned counts must tell a genuinely new insert from a re-scrape."""
    from src.db.mutations.scraper import upsert_transactions

    row = _txn_row()

    assert upsert_transactions([row]) == (1, 0)
    # Identical re-scrape: the DO UPDATE's WHERE guard rejects it, so it is
    # neither an insert nor an update — updated_at must not churn and the
    # 5-minute cache must not be dirtied for nothing.
    assert upsert_transactions([row]) == (0, 0)

    with scraper_db.connect() as fresh_conn:
        count = fresh_conn.execute(
            sa.text("SELECT count(*) FROM transactions WHERE unique_id = :uid"),
            {"uid": row["unique_id"]},
        ).scalar_one()
    assert count == 1


def test_upsert_backfills_a_category_onto_a_row_already_stored(scraper_db):
    """#135/#149: enrichment is budgeted and converges over several syncs, so a
    row inserted unenriched has to be able to pick up its category later. Under
    the old DO NOTHING it never could."""
    from src.db.mutations.scraper import upsert_transactions

    upsert_transactions([_txn_row()])
    assert _stored(scraper_db, "2026-06-01_isracard_1234_10_abc").bank_category is None

    inserted, updated = upsert_transactions(
        [
            _txn_row(
                bank_category="פארמה",
                raw='{"description": "STARBUCKS", "category": "פארמה"}',
            )
        ]
    )
    assert (inserted, updated) == (0, 1)

    stored = _stored(scraper_db, "2026-06-01_isracard_1234_10_abc")
    assert stored.bank_category == "פארמה"
    assert "category" in stored.raw


def test_an_unenriched_rescrape_never_erases_an_existing_category(scraper_db):
    """The trap this upsert is shaped around: a sync with enrichment off, or one
    whose budget ran out, yields transactions with no category. If that erased
    what an earlier, more expensive run collected, enrichment could never
    converge — every run would undo the last."""
    from src.db.mutations.scraper import upsert_transactions

    enriched_raw = '{"description": "STARBUCKS", "category": "פארמה"}'
    upsert_transactions([_txn_row(bank_category="פארמה", raw=enriched_raw)])
    before = _stored(scraper_db, "2026-06-01_isracard_1234_10_abc")

    # Exactly what the sidecar returns when enrichment was skipped: same
    # transaction, no category, and a `raw` that is missing the enrichment.
    inserted, updated = upsert_transactions([_txn_row()])

    after = _stored(scraper_db, "2026-06-01_isracard_1234_10_abc")
    assert after.bank_category == "פארמה", "the category was clobbered"
    assert "category" in after.raw, "raw was rolled back to the unenriched copy"
    assert (inserted, updated) == (0, 0), "a strictly poorer copy is not an update"
    assert after.updated_at == before.updated_at


def test_upsert_refreshes_memo_and_raw_on_a_row_that_was_never_enriched(scraper_db):
    """Guarding against the clobber above must not block the ordinary #135
    refresh for providers that have no category at all."""
    from src.db.mutations.scraper import upsert_transactions

    upsert_transactions([_txn_row(company_id="max", memo=None)])
    inserted, updated = upsert_transactions(
        [_txn_row(company_id="max", memo="תשלום 1 מתוך 3", raw='{"moreInfo": "x"}')]
    )

    assert (inserted, updated) == (0, 1)
    stored = _stored(scraper_db, "2026-06-01_isracard_1234_10_abc")
    assert stored.memo == "תשלום 1 מתוך 3"
    assert "moreInfo" in stored.raw


def test_an_empty_category_records_that_the_provider_has_none(scraper_db):
    """'' means "we asked, there is nothing" - it must stick, so the transaction
    stops being counted as a backlog and stops being re-requested every sync."""
    from src.db.mutations.scraper import upsert_transactions
    from src.db.queries.scraper import pending_enrichment_count

    upsert_transactions([_txn_row(bank_category="")])

    stored = _stored(scraper_db, "2026-06-01_isracard_1234_10_abc")
    assert stored.bank_category == ""
    assert pending_enrichment_count(["2026-06-01_isracard_1234_10_abc"]) == 0


def test_an_empty_category_never_displaces_a_real_one(scraper_db):
    """The other half: a transient empty answer must not wipe a category an
    earlier run collected."""
    from src.db.mutations.scraper import upsert_transactions

    upsert_transactions([_txn_row(bank_category="פארמה")])
    inserted, updated = upsert_transactions([_txn_row(bank_category="")])

    assert _stored(scraper_db, "2026-06-01_isracard_1234_10_abc").bank_category == "פארמה"
    assert (inserted, updated) == (0, 0)


def test_pending_count_ignores_rows_this_scrape_did_not_return(scraper_db):
    """Observed live: four amex rows sat one day outside what the provider still
    returns, so every re-run reported them missing, asked about none of them,
    and the number never moved. The count must mean "what a re-run could fix"."""
    from src.db.mutations.scraper import upsert_transactions
    from src.db.queries.scraper import pending_enrichment_count

    upsert_transactions(
        [
            _txn_row(unique_id="scraped-now", bank_category=None),
            # Stored by an older sync; the provider no longer returns it.
            _txn_row(unique_id="abandoned", activity_date="2026-01-01", bank_category=None),
        ]
    )

    assert pending_enrichment_count(["scraped-now"]) == 1
    assert pending_enrichment_count([]) == 0, "a scrape that returned nothing owes nothing"


def test_an_identifier_is_skippable_only_when_every_row_carrying_it_is_enriched(scraper_db):
    """Identifiers are not unique per row: installments split one voucher number
    across billing months, which is ~1-3% of them in real data (all on the SAME
    card, so keying by account would not help). If one such row is enriched and
    its twin is not, treating the identifier as done skips the twin forever -
    and because the twin is still in the scrape's output, it is also counted as
    missing forever."""
    from src.db.mutations.scraper import upsert_transactions
    from src.db.queries.scraper import enriched_identifiers

    upsert_transactions(
        [
            # Two payments of one installment plan: same card, same identifier.
            _txn_row(unique_id="inst-1", identifier="shared", bank_category="פארמה"),
            _txn_row(unique_id="inst-2", identifier="shared", bank_category=None),
            # A plain one-row identifier, fully enriched.
            _txn_row(unique_id="solo", identifier="alone", bank_category="דלק"),
        ]
    )

    skip = enriched_identifiers("isracard", "2026-05-01")
    assert "alone" in skip
    assert "shared" not in skip, "skipping this strands inst-2 with no category, permanently"


def test_enriched_identifiers_and_pending_count_drive_the_skip_set(scraper_db):
    """What the next sync sends the sidecar, and what the UI shows as remaining.
    Both are windowed and per-company, so neither can leak across providers."""
    from src.db.mutations.scraper import upsert_transactions
    from src.db.queries.scraper import enriched_identifiers, pending_enrichment_count

    upsert_transactions(
        [
            _txn_row(unique_id="u1", identifier="abc", bank_category="פארמה"),
            _txn_row(unique_id="u2", identifier="def", bank_category=None),
            # Same window, different provider — must not appear in isracard's set.
            _txn_row(unique_id="u3", identifier="ghi", company_id="amex", bank_category="דלק"),
            # Enriched, but older than the window the next sync will ask about.
            _txn_row(
                unique_id="u4",
                identifier="jkl",
                activity_date="2026-01-01",
                bank_category="מזון",
            ),
        ]
    )

    assert enriched_identifiers("isracard", "2026-05-01") == ["abc"]
    assert enriched_identifiers("amex", "2026-05-01") == ["ghi"]
    # "def" is the only one of these the scrape returned that still needs a
    # category; "jkl" is enriched and "u3" belongs to amex.
    assert pending_enrichment_count(["u1", "u2", "u4"]) == 1
    assert pending_enrichment_count(["u3"]) == 0


def test_get_last_run_carries_the_enrichment_counters(scraper_db):
    """A successful run can still be short of categories; the run row is where
    the UI learns that."""
    from src.db.mutations.scraper import (
        finish_run,
        finish_run_account,
        insert_run,
        insert_run_account,
    )
    from src.db.queries.scraper import get_last_run

    run_id = insert_run(lookback_days=30)
    insert_run_account(run_id, account="1234", company_id="isracard")
    insert_run_account(run_id, account="5678", company_id="max")
    finish_run_account(run_id, "1234", "isracard", "success", None, 5, None, 60, 180)
    # max has no enrichment pass at all — that is not a backlog of zero.
    finish_run_account(run_id, "5678", "max", "success", None, 3)
    finish_run(run_id, "success")

    accounts = {a["company_id"]: a for a in get_last_run()["accounts"]}
    assert accounts["isracard"]["enrichment_added"] == 60
    assert accounts["isracard"]["enrichment_missing"] == 180
    assert accounts["max"]["enrichment_added"] is None
    assert accounts["max"]["enrichment_missing"] is None
