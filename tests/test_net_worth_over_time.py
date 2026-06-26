"""Unit tests for the net-worth time-series helpers in ``backend.data``.

Regression coverage for issue #50: when different accounts are tracked on
different dates, the line plots used to dip because the per-date sum dropped
accounts that weren't scraped that day. The fix forward-fills each account's
last known balance across the union of tracking dates before aggregating.
"""

from unittest.mock import patch

import pandas as pd

from backend.data import (
    forward_fill_account_balances,
    get_net_worth_by_category_over_time,
    get_net_worth_over_time,
)


def _tracking(rows: list[tuple[int, str, float]]) -> pd.DataFrame:
    """Build an investment_accounts_tracking frame from (account_id, date, amount) tuples."""
    return pd.DataFrame(
        [
            {
                "investment_accounts_id": acc_id,
                "activity_date": pd.Timestamp(date),
                "amount": amount,
            }
            for acc_id, date, amount in rows
        ]
    )


def _accounts(rows: list[tuple]) -> pd.DataFrame:
    """Build an investment_accounts frame from (id, person, category[, is_active]) tuples.

    ``is_active`` defaults to True so existing call-sites stay unchanged.
    """
    return pd.DataFrame(
        [
            {
                "id": row[0],
                "person": row[1],
                "account_type_category": row[2],
                "is_active": row[3] if len(row) > 3 else True,
            }
            for row in rows
        ]
    )


class TestForwardFillAccountBalances:
    def test_empty_input(self):
        result = forward_fill_account_balances(_tracking([]))
        assert result.empty
        assert list(result.columns) == [
            "activity_date",
            "investment_accounts_id",
            "amount",
        ]

    def test_single_account_unchanged(self):
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (1, "2025-02-01", 110.0),
            ]
        )
        result = forward_fill_account_balances(tracking).sort_values("activity_date")
        assert list(result["amount"]) == [100.0, 110.0]

    def test_carries_balance_forward_to_other_accounts_dates(self):
        # Account 1 only has a record on Jan 1; account 2 has records on Jan 1 and Feb 1.
        # On Feb 1 the union timeline should still include account 1 at its Jan 1 value.
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (2, "2025-01-01", 50.0),
                (2, "2025-02-01", 60.0),
            ]
        )
        result = forward_fill_account_balances(tracking)
        feb = result[result["activity_date"] == pd.Timestamp("2025-02-01")]
        balances = dict(zip(feb["investment_accounts_id"], feb["amount"]))
        assert balances == {1: 100.0, 2: 60.0}

    def test_does_not_backfill_before_first_record(self):
        # Account 2's first record is Feb 1; it must not appear on Jan 1.
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (2, "2025-02-01", 50.0),
            ]
        )
        result = forward_fill_account_balances(tracking)
        jan = result[result["activity_date"] == pd.Timestamp("2025-01-01")]
        assert list(jan["investment_accounts_id"]) == [1]

    def test_duplicate_account_date_keeps_last(self):
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (1, "2025-01-01", 105.0),
            ]
        )
        result = forward_fill_account_balances(tracking)
        assert list(result["amount"]) == [105.0]

    def test_inactive_account_drops_after_last_record(self):
        # Account 2 is closed: its balance must not be carried past its final
        # record (Feb 1), but its earlier history is preserved.
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (2, "2025-01-01", 80.0),
                (2, "2025-02-01", 85.0),
                (1, "2025-03-01", 110.0),
            ]
        )
        result = forward_fill_account_balances(tracking, inactive_ids=frozenset({2}))

        # Mar 1: only the still-active account 1 remains.
        mar = result[result["activity_date"] == pd.Timestamp("2025-03-01")]
        assert list(mar["investment_accounts_id"]) == [1]

        # Feb 1: account 2 still counts at its last balance; account 1 forward-fills.
        feb = result[result["activity_date"] == pd.Timestamp("2025-02-01")]
        assert dict(zip(feb["investment_accounts_id"], feb["amount"])) == {1: 100.0, 2: 85.0}


def _patch_mock_data(tracking: pd.DataFrame, accounts: pd.DataFrame):
    """Patch the mock-data getters used by the data layer when USE_MOCK_DATA is on."""
    return patch.multiple(
        "backend.data",
        get_investment_tracking=lambda: tracking,
        get_investment_accounts=lambda: accounts,
        is_mock_mode=lambda: True,
    )


class TestGetNetWorthOverTime:
    def test_no_dip_when_accounts_tracked_on_different_dates(self):
        # Same person, two accounts, tracked on offset dates.
        # Each per-date sum must include BOTH accounts' last known balance.
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (2, "2025-01-15", 50.0),
                (1, "2025-02-01", 110.0),
                (2, "2025-02-15", 55.0),
            ]
        )
        accounts = _accounts(
            [
                (1, "Alice", "investments"),
                (2, "Alice", "investments"),
            ]
        )
        with _patch_mock_data(tracking, accounts):
            result = get_net_worth_over_time()

        sums = dict(zip(result["activity_date"], result["total_amount"]))
        # Before the fix, Jan 15 only included account 2 ($50) — a visible dip.
        assert sums[pd.Timestamp("2025-01-15")] == 100.0 + 50.0
        assert sums[pd.Timestamp("2025-02-01")] == 110.0 + 50.0
        assert sums[pd.Timestamp("2025-02-15")] == 110.0 + 55.0

    def test_sums_persons_independently(self):
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (2, "2025-01-15", 50.0),
            ]
        )
        accounts = _accounts(
            [
                (1, "Alice", "investments"),
                (2, "Bob", "investments"),
            ]
        )
        with _patch_mock_data(tracking, accounts):
            result = get_net_worth_over_time()

        # Jan 15 is in the timeline → Alice's $100 forward-fills, Bob has $50.
        jan15 = result[result["activity_date"] == pd.Timestamp("2025-01-15")]
        sums = dict(zip(jan15["person"], jan15["total_amount"]))
        assert sums == {"Alice": 100.0, "Bob": 50.0}

    def test_empty_tracking_returns_empty_frame(self):
        with _patch_mock_data(_tracking([]), _accounts([(1, "Alice", "investments")])):
            result = get_net_worth_over_time()
        assert result.empty
        assert list(result.columns) == ["activity_date", "person", "total_amount"]

    def test_latest_total_excludes_closed_account(self):
        # A closed account's stale balance must not inflate the latest net worth.
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (2, "2025-01-01", 80.0),
                (2, "2025-02-01", 80.0),
                (1, "2025-03-01", 110.0),
            ]
        )
        accounts = _accounts(
            [
                (1, "Alice", "investments", True),
                (2, "Alice", "investments", False),  # closed, last tracked Feb 1
            ]
        )
        with _patch_mock_data(tracking, accounts):
            result = get_net_worth_over_time()

        last_date = result["activity_date"].max()
        latest_total = result[result["activity_date"] == last_date]["total_amount"].sum()
        # Before the fix account 2's $80 forward-filled to Mar 1 → $190.
        assert latest_total == 110.0


class TestGetNetWorthByCategoryOverTime:
    def test_forward_fills_across_categories(self):
        # Two accounts in different categories, tracked on offset dates.
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (2, "2025-01-15", 50.0),
                (1, "2025-02-01", 110.0),
            ]
        )
        accounts = _accounts(
            [
                (1, "Alice", "investments"),
                (2, "Alice", "pension"),
            ]
        )
        with _patch_mock_data(tracking, accounts):
            result = get_net_worth_by_category_over_time()

        # Jan 15 must include the investments category at its Jan 1 value.
        jan15 = result[result["activity_date"] == pd.Timestamp("2025-01-15")]
        by_cat = dict(zip(jan15["account_type_category"], jan15["total_amount"]))
        assert by_cat == {"investments": 100.0, "pension": 50.0}

        # Feb 1: pension's Jan 15 balance carries forward; investments updates.
        feb1 = result[result["activity_date"] == pd.Timestamp("2025-02-01")]
        by_cat_feb = dict(zip(feb1["account_type_category"], feb1["total_amount"]))
        assert by_cat_feb == {"investments": 110.0, "pension": 50.0}

    def test_closed_account_does_not_inflate_category(self):
        # Provider switch within one category: the old fund (1) closes after Feb,
        # its balance moves into the new fund (2). The category total must reflect
        # only the new fund afterwards — not stale-old + new (the reported bug).
        tracking = _tracking(
            [
                (1, "2025-01-01", 100.0),
                (1, "2025-02-01", 100.0),  # old fund's last balance before the switch
                (2, "2025-03-01", 105.0),  # money now in the new fund
                (2, "2025-04-01", 110.0),
            ]
        )
        accounts = _accounts(
            [
                (1, "Gomez", "hishtalmut", False),  # closed
                (2, "Gomez", "hishtalmut", True),  # active
            ]
        )
        with _patch_mock_data(tracking, accounts):
            result = get_net_worth_by_category_over_time()

        by_date = dict(zip(result["activity_date"], result["total_amount"]))
        # While the old fund was alive its balance counts.
        assert by_date[pd.Timestamp("2025-02-01")] == 100.0
        # After the switch, only the new fund — before the fix these were 205 / 210.
        assert by_date[pd.Timestamp("2025-03-01")] == 105.0
        assert by_date[pd.Timestamp("2025-04-01")] == 110.0
