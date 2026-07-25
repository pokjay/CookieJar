"""Unit tests for the Wealthfolio CSV export transforms."""

import pandas as pd
import pytest

from src.utils.wealthfolio_export import (
    EXPORT_COLUMNS,
    RULES_COLUMNS,
    account_filename,
    build_rules_ranking,
    to_wealthfolio_rows,
)


def _txn_df(rows: list[dict]) -> pd.DataFrame:
    defaults = {
        "account": "Visa 1234",
        "status": "completed",
        "activity_date": "2026-06-01",
        "charged_amount": 100.0,
        "charged_currency": "ILS",
        "description": "raw desc",
        "processed_description": "processed desc",
        "category": None,
        "subcategory": None,
    }
    return pd.DataFrame([{**defaults, **row} for row in rows])


class TestToWealthfolioRows:
    def test_expense_becomes_withdrawal_with_positive_amount(self):
        out = to_wealthfolio_rows(_txn_df([{"charged_amount": 250.5}]))
        assert list(out.columns) == ["account", *EXPORT_COLUMNS]
        row = out.iloc[0]
        assert row["activityType"] == "WITHDRAWAL"
        assert row["amount"] == 250.5
        assert row["date"] == "2026-06-01"

    def test_refund_uses_refund_type_and_abs_amount(self):
        df = _txn_df([{"charged_amount": -80.0}])
        assert to_wealthfolio_rows(df).iloc[0]["activityType"] == "CREDIT"
        out = to_wealthfolio_rows(df, refund_type="DEPOSIT")
        assert out.iloc[0]["activityType"] == "DEPOSIT"
        assert out.iloc[0]["amount"] == 80.0

    def test_invalid_refund_type_rejected(self):
        with pytest.raises(ValueError, match="refund_type"):
            to_wealthfolio_rows(_txn_df([{}]), refund_type="REBATE")

    def test_pending_and_zero_amount_rows_dropped(self):
        out = to_wealthfolio_rows(
            _txn_df(
                [
                    {"status": "pending", "processed_description": "pending row"},
                    {"charged_amount": 0.0, "processed_description": "zero row"},
                    {"processed_description": "kept row"},
                ]
            )
        )
        assert out["comment"].tolist() == ["kept row"]

    def test_comment_prefers_processed_description_with_raw_fallback(self):
        out = to_wealthfolio_rows(
            _txn_df(
                [
                    {"processed_description": "Wolt - Place A", "description": "Wolt"},
                    {"processed_description": None, "description": "raw only"},
                ]
            )
        )
        assert out["comment"].tolist() == ["Wolt - Place A", "raw only"]

    def test_missing_currency_defaults_to_ils(self):
        out = to_wealthfolio_rows(_txn_df([{"charged_currency": None}]))
        assert out.iloc[0]["currency"] == "ILS"

    def test_currency_symbols_normalized_to_iso_codes(self):
        out = to_wealthfolio_rows(
            _txn_df(
                [
                    {"charged_currency": "₪", "activity_date": "2026-06-01"},
                    {"charged_currency": "ILS", "activity_date": "2026-06-02"},
                    {"charged_currency": " ils ", "activity_date": "2026-06-03"},
                    {"charged_currency": "", "activity_date": "2026-06-04"},
                    {"charged_currency": "€", "activity_date": "2026-06-05"},
                ]
            )
        )
        assert out["currency"].tolist() == ["ILS", "ILS", "ILS", "ILS", "EUR"]

    def test_rows_sorted_by_date(self):
        out = to_wealthfolio_rows(
            _txn_df(
                [
                    {"activity_date": "2026-06-15"},
                    {"activity_date": "2026-06-01"},
                ]
            )
        )
        assert out["date"].tolist() == ["2026-06-01", "2026-06-15"]


class TestBuildRulesRanking:
    def test_ranks_by_count_with_cumulative_pct(self):
        df = _txn_df(
            [
                *[{"processed_description": "Super A", "category": "Supermarket"}] * 3,
                {
                    "processed_description": "Cafe B",
                    "category": "Eating Out",
                    "subcategory": "Cafe",
                },
                {"processed_description": "no category"},
            ]
        )
        ranked = build_rules_ranking(df)
        assert list(ranked.columns) == RULES_COLUMNS
        assert ranked["processed_description"].tolist() == ["Super A", "Cafe B"]
        assert ranked["txn_count"].tolist() == [3, 1]
        assert ranked["cumulative_txn_pct"].tolist() == [75.0, 100.0]

    def test_refunds_count_as_absolute_amounts(self):
        df = _txn_df(
            [{"processed_description": "Cashback", "category": "Cashback", "charged_amount": -50.0}]
        )
        assert build_rules_ranking(df).iloc[0]["total_amount"] == 50.0

    def test_no_categorized_rows_returns_empty_frame(self):
        ranked = build_rules_ranking(_txn_df([{}]))
        assert ranked.empty
        assert list(ranked.columns) == RULES_COLUMNS


class TestAccountFilename:
    def test_sanitizes_and_deduplicates(self):
        taken: set[str] = set()
        assert account_filename("Visa 1234", taken) == "Visa_1234.csv"
        assert account_filename("Visa/1234", taken) == "Visa_1234_2.csv"
        assert account_filename("///", taken) == "account.csv"
