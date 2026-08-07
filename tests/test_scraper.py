"""Tests for the scraper feature: unique_id derivation, mock-mode guards, the
sync-start race-condition -> 409 mapping, and run_sync's account-number
selection, timezone handling, and run-finishing guarantees.
"""

import os
from contextlib import ExitStack, contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import ANY, patch

import httpx
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend import scraper_sync  # noqa: E402
from backend.routers import scraper as scraper_router  # noqa: E402
from backend.scraper_sync import (  # noqa: E402
    _build_transaction_row,
    _scrape_account,
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


def test_transaction_unique_id_naive_datetime_truncates_directly():
    """A naive datetime carries no offset, meaning it already is local wall
    time - it truncates to its own calendar date without tz conversion."""
    tx = {"date": "2026-06-01T00:00:00", "chargedAmount": 1, "identifier": "x"}
    assert transaction_unique_id(tx, "isracard", "1234") == "2026-06-01_isracard_1234_1_x"


def test_build_transaction_row_naive_datetime_activity_date_is_date():
    tx = {"date": "2026-06-01T00:00:00", "chargedAmount": 1, "identifier": "x"}
    row = _build_transaction_row(tx, "isracard", "1234")
    assert row["activity_date"] == date(2026, 6, 1)


def test_build_transaction_row_unparseable_date_returns_none():
    """activity_date is a DATE NOT NULL column; a row that can't produce a real
    date must be dropped (and logged) rather than poison the batched insert."""
    tx = {"date": "not-a-date", "chargedAmount": 1, "identifier": "x"}
    assert _build_transaction_row(tx, "isracard", "1234") is None


# ── bank_category — the enrichment pass's only product, promoted out of `raw`
#    so it is queryable and so the next sync knows what it already paid for. ──


def test_build_transaction_row_promotes_the_bank_category():
    tx = {
        "date": "2026-06-01T00:00:00.000Z",
        "chargedAmount": 1,
        "identifier": "x",
        # The library trims PirteyIska_204Bean.sector, but not always cleanly.
        "category": "  פארמה  ",
    }
    assert _build_transaction_row(tx, "isracard", "1234")["bank_category"] == "פארמה"


def test_build_transaction_row_no_category_key_means_never_asked():
    """The sidecar only adds a `category` key when its fetch actually returned
    data, so an absent key means the enrichment pass skipped or deferred this
    transaction. That must be NULL - "still owed one" - so the upsert keeps
    whatever an earlier run collected instead of erasing it."""
    tx = {"date": "2026-06-01T00:00:00.000Z", "chargedAmount": 1, "identifier": "x"}
    assert _build_transaction_row(tx, "isracard", "1234")["bank_category"] is None


@pytest.mark.parametrize("category", ["", "   "], ids=["empty", "blank"])
def test_build_transaction_row_empty_category_means_the_provider_has_none(category):
    """A present-but-empty category is an ANSWER: we asked and the provider had
    nothing. Folding it into NULL would make us re-ask every sync and report it
    as a backlog that can never reach zero."""
    tx = {
        "date": "2026-06-01T00:00:00.000Z",
        "chargedAmount": 1,
        "identifier": "x",
        "category": category,
    }
    assert _build_transaction_row(tx, "isracard", "1234")["bank_category"] == ""


# ── src/db/mutations/scraper.py — every function must guard is_mock_mode()
#    itself and never touch the DB in mock mode. ─────────────────────────────


def test_insert_run_mock_mode_never_hits_db():
    with patch("src.db.mutations.scraper.execute_returning") as returning:
        run_id = scraper_mutations.insert_run(30)
    assert run_id == "mock-run-id"
    returning.assert_not_called()


def test_upsert_transactions_mock_mode_never_hits_db():
    with patch("src.db.mutations.scraper.execute_upserts_batch") as batch:
        counts = scraper_mutations.upsert_transactions([{"unique_id": "x"}])
    assert counts == (0, 0)
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
    stack.enter_context(patch("backend.scraper_sync.enriched_identifiers", return_value=[]))
    stack.enter_context(patch("backend.scraper_sync.pending_enrichment_count", return_value=0))
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


# ── run_sync() — per-account error classification and overall-status roll-up
#    (#110): all-success → success, mixed → partial, all-error → error. ───────


@contextmanager
def _run_sync_harness(scrape=None, upsert=None, enriched=None, pending=0):
    """Like _run_sync_mocks, but takes side_effects (so successive accounts can
    get different results) and yields the mocks so tests can assert on
    finish_run / finish_run_account calls."""
    with (
        patch("backend.scraper_sync.is_mock_mode", return_value=False),
        patch("backend.scraper_sync.insert_run_account"),
        patch("backend.scraper_sync.finish_run_account") as finish_run_account,
        patch("backend.scraper_sync.finish_run") as finish_run,
        patch("backend.scraper_sync.clear_all") as clear_all,
        patch("backend.scraper_sync._scrape_account", side_effect=scrape) as scrape_mock,
        patch("backend.scraper_sync.upsert_transactions", side_effect=upsert) as upsert_mock,
        patch(
            "backend.scraper_sync.enriched_identifiers", return_value=enriched or []
        ) as enriched_mock,
        patch(
            "backend.scraper_sync.pending_enrichment_count", return_value=pending
        ) as pending_mock,
    ):
        yield SimpleNamespace(
            finish_run_account=finish_run_account,
            finish_run=finish_run,
            clear_all=clear_all,
            upsert=upsert_mock,
            scrape_account=scrape_mock,
            enriched_identifiers=enriched_mock,
            pending_enrichment_count=pending_mock,
        )


_OK = {"errorType": None, "accountNumber": "1111", "transactions": []}
_TWO_ACCOUNTS = [
    {"companyId": "isracard", "accountTitle": "A"},
    {"companyId": "visaCal", "accountTitle": "B"},
]


def test_run_sync_all_success_finishes_run_success_and_clears_cache_once():
    with _run_sync_harness(scrape=[_OK, _OK], upsert=lambda rows: (len(rows), 0)) as mocks:
        run_sync(_TWO_ACCOUNTS, "run-1", 30)
    mocks.finish_run.assert_called_once_with("run-1", "success")
    mocks.clear_all.assert_called_once()


def test_run_sync_mixed_results_finish_run_partial():
    failed = {"errorType": "wrong-credentials", "transactions": []}
    with _run_sync_harness(scrape=[_OK, failed], upsert=lambda rows: (len(rows), 0)) as mocks:
        run_sync(_TWO_ACCOUNTS, "run-1", 30)
    mocks.finish_run.assert_called_once_with("run-1", "partial")
    mocks.finish_run_account.assert_any_call(
        "run-1", "B", "visaCal", "error", "wrong-credentials", 0, None
    )


def test_run_sync_all_error_finishes_run_error():
    failed = {"errorType": "timeout", "transactions": []}
    with _run_sync_harness(scrape=[failed, failed]) as mocks:
        run_sync(_TWO_ACCOUNTS, "run-1", 30)
    mocks.finish_run.assert_called_once_with("run-1", "error")


def test_run_sync_empty_credential_list_finishes_run_error():
    """The router 422s before dispatching an empty vault, but run_sync must not
    report a run that scraped nothing as 'success' if it's ever reached."""
    with _run_sync_harness() as mocks:
        run_sync([], "run-1", 30)
    mocks.finish_run.assert_called_once_with("run-1", "error")
    mocks.clear_all.assert_called_once()


def test_run_sync_sidecar_error_type_reaches_the_account_row_without_upsert():
    """The sidecar's errorType (e.g. wrong-credentials from the #110 mapping
    fix) must land on the run-account row untouched, and no upsert may run for
    a failed account."""
    failed = {"errorType": "account-blocked", "transactions": []}
    with _run_sync_harness(scrape=[failed]) as mocks:
        run_sync([{"companyId": "max", "accountTitle": "M"}], "run-1", 30)
    mocks.finish_run_account.assert_called_once_with(
        "run-1", "M", "max", "error", "account-blocked", 0, None
    )
    mocks.upsert.assert_not_called()


def test_run_sync_sidecar_error_message_reaches_the_account_row():
    """The sidecar's human-readable explanation is what makes a failure
    actionable in the UI — error_type alone is just a code."""
    explanation = "The provider rate-limited the scraper (HTTP 429)."
    failed = {
        "errorType": "generic-error",
        "errorMessage": explanation,
        "transactions": [],
    }
    with _run_sync_harness(scrape=[failed]) as mocks:
        run_sync([{"companyId": "isracard", "accountTitle": "A"}], "run-1", 30)
    mocks.finish_run_account.assert_called_once_with(
        "run-1", "A", "isracard", "error", "generic-error", 0, explanation
    )


def test_run_sync_forwards_the_extra_details_opt_in_and_defaults_it_off():
    """additionalTransactionInformation used to default off because a 429 during
    that pass discarded the whole scrape. The governor absorbs that now and the
    pass is budgeted, so it defaults ON — but the caller can still turn it off."""
    with _run_sync_harness(scrape=[_OK, _OK], upsert=lambda rows: (len(rows), 0)) as mocks:
        run_sync([{"companyId": "isracard", "accountTitle": "A"}], "run-1", 30)
        run_sync([{"companyId": "isracard", "accountTitle": "A"}], "run-2", 30, False)

    sent = [call.args[2] for call in mocks.scrape_account.call_args_list]
    assert sent == [True, False]


def test_scrape_account_sends_the_extra_details_flag_to_the_sidecar():
    """The flag has to survive the HTTP hop, not just run_sync's signature."""
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return _OK

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def post(self, url, json, headers):
            captured.update(json)
            return _Resp()

    with patch("backend.scraper_sync.httpx.Client", return_value=_Client()):
        _scrape_account({"companyId": "isracard"}, "2026-07-01", True, ["abc", "def"], 120.0)

    assert captured["additionalTransactionInformation"] is True
    # The sidecar has no database, so the skip set and the budget can only come
    # from here — without them it re-enriches the whole window every sync.
    assert captured["enrichedIdentifiers"] == ["abc", "def"]
    assert captured["enrichmentBudgetSeconds"] == 120.0
    assert captured["enrichmentDelayMs"] > 0


def test_run_sync_connect_error_marks_account_unavailable():
    """Sidecar container down → the account fails as 'unavailable' (a
    deployment problem), never as a credential/scrape problem."""
    with _run_sync_harness(scrape=httpx.ConnectError("connection refused")) as mocks:
        run_sync([{"companyId": "isracard", "accountTitle": "A"}], "run-1", 30)
    mocks.finish_run_account.assert_called_once_with(
        "run-1", "A", "isracard", "error", "unavailable", 0, ANY
    )
    mocks.finish_run.assert_called_once_with("run-1", "error")


def test_run_sync_other_request_failure_marks_account_unknown():
    with _run_sync_harness(
        scrape=httpx.HTTPStatusError("500", request=None, response=None)
    ) as mocks:
        run_sync([{"companyId": "isracard", "accountTitle": "A"}], "run-1", 30)
    mocks.finish_run_account.assert_called_once_with(
        "run-1", "A", "isracard", "error", "unknown", 0, ANY
    )


def test_run_sync_upsert_failure_marks_db_error_and_continues_to_next_account():
    """A DB failure on one account must not abort the run: the account gets
    'db_error', the loop moves on, and the overall status reflects the mix."""

    def upsert_side_effect(rows):
        if not upsert_side_effect.calls:
            upsert_side_effect.calls.append(1)
            raise RuntimeError("insert failed")
        return (len(rows), 0)

    upsert_side_effect.calls = []

    with _run_sync_harness(scrape=[_OK, _OK], upsert=upsert_side_effect) as mocks:
        run_sync(_TWO_ACCOUNTS, "run-1", 30)

    mocks.finish_run_account.assert_any_call("run-1", "A", "isracard", "error", "db_error", 0, ANY)
    # visaCal has no enrichment pass, so both enrichment counters stay None —
    # "does not apply", which the UI renders as no counter at all rather than as
    # a backlog of zero.
    mocks.finish_run_account.assert_any_call(
        "run-1", "B", "visaCal", "success", None, 0, None, None, None
    )
    mocks.finish_run.assert_called_once_with("run-1", "partial")


# ── the enrichment budget — shared across a run, not granted per account ─────


_ENRICHING_TWO = [
    {"companyId": "isracard", "accountTitle": "A"},
    {"companyId": "amex", "accountTitle": "B"},
]


def _budgets(mocks):
    """The enrichmentBudgetSeconds each account was handed."""
    return [call.args[4] for call in mocks.scrape_account.call_args_list]


def test_run_sync_splits_the_budget_between_accounts_that_need_it():
    """Handing the whole budget to the first account would let it converge while
    the last one never starts — and the UI would show a backlog that never
    moves."""
    ok = {**_OK, "enrichment": {"enriched": 0, "spentMs": 0}}
    with _run_sync_harness(scrape=[ok, ok], upsert=lambda rows: (len(rows), 0)) as mocks:
        run_sync(_ENRICHING_TWO, "run-1", 30)

    first, second = _budgets(mocks)
    assert first == pytest.approx(scraper_sync._ENRICHMENT_BUDGET_SECONDS / 2)
    # The first account spent nothing, so its share returns to the pool rather
    # than being lost.
    assert second == pytest.approx(scraper_sync._ENRICHMENT_BUDGET_SECONDS)


def test_run_sync_charges_the_budget_for_what_an_account_actually_spent():
    spent = {**_OK, "enrichment": {"enriched": 12, "spentMs": 60_000}}
    ok = {**_OK, "enrichment": {"enriched": 0, "spentMs": 0}}
    with _run_sync_harness(scrape=[spent, ok], upsert=lambda rows: (len(rows), 0)) as mocks:
        run_sync(_ENRICHING_TWO, "run-1", 30)

    _, second = _budgets(mocks)
    assert second == pytest.approx(scraper_sync._ENRICHMENT_BUDGET_SECONDS - 60)


def test_run_sync_gives_no_budget_to_providers_without_an_enrichment_pass():
    """visaCal supplies its category with the transaction and max has none, so
    neither spends enrichment time — and neither may take a slice that an
    isracard account needs."""
    accounts = [
        {"companyId": "visaCal", "accountTitle": "C"},
        {"companyId": "isracard", "accountTitle": "A"},
    ]
    ok = {**_OK, "enrichment": {"enriched": 0, "spentMs": 0}}
    with _run_sync_harness(scrape=[ok, ok], upsert=lambda rows: (len(rows), 0)) as mocks:
        run_sync(accounts, "run-1", 30)

    cal_budget, isracard_budget = _budgets(mocks)
    assert cal_budget is None
    assert isracard_budget == pytest.approx(scraper_sync._ENRICHMENT_BUDGET_SECONDS)
    mocks.enriched_identifiers.assert_called_once_with("isracard", ANY)


def test_run_sync_asks_for_no_enrichment_when_the_caller_opted_out():
    ok = {**_OK, "enrichment": {"enriched": 0, "spentMs": 0}}
    with _run_sync_harness(scrape=[ok], upsert=lambda rows: (len(rows), 0)) as mocks:
        run_sync([{"companyId": "isracard", "accountTitle": "A"}], "run-1", 30, False)

    assert _budgets(mocks) == [None]
    mocks.enriched_identifiers.assert_not_called()
    mocks.finish_run_account.assert_called_once_with(
        "run-1", "A", "isracard", "success", None, 0, None, None, None
    )


def test_run_sync_reports_the_backlog_from_the_database_not_the_sidecar():
    """The sidecar sees one scrape; the backlog is a property of the window,
    including rows stored by earlier runs that still have no category."""
    ok = {**_OK, "enrichment": {"enriched": 60, "spentMs": 1000}}
    with _run_sync_harness(scrape=[ok], upsert=lambda rows: (len(rows), 0), pending=180) as mocks:
        run_sync([{"companyId": "isracard", "accountTitle": "A"}], "run-1", 30)

    mocks.finish_run_account.assert_called_once_with(
        "run-1", "A", "isracard", "success", None, 0, None, 60, 180
    )


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
