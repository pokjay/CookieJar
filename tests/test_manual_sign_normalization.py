"""Unit tests for signing manually-imported transactions by their intent.

Manual rows keep whatever sign the source bank exported — the bank accounts
write expenses negative, the card accounts write them positive — and the
``processed_transcations_with_categories`` view negates them a second time. Sign
alone therefore cannot say whether a manual row is spend, which silently hid
bank-paid expenses (rent, daycare) from the Sankey and from anything else
filtering on ``charged_amount > 0``.

These tests pin the replacement rule: cash_flow_type decides the sign.
"""

import pandas as pd
import pytest

from src.db.queries.transactions import normalize_manual_signs
from src.utils.calculations import prepare_sankey_data


def _view_rows(rows: list[tuple]) -> pd.DataFrame:
    """Build a frame shaped like the processed-transactions view."""
    return pd.DataFrame(
        [
            {
                "account": account,
                "activity_date": pd.Timestamp(date),
                "charged_amount": amount,
                "cash_flow_type": cft,
                "category": category,
                "subcategory": category,
                "person": "Gomez",
            }
            for account, date, amount, cft, category in rows
        ]
    )


class TestNormalizeManualSigns:
    @pytest.mark.parametrize("stored", [-8000, 8000])
    def test_expense_is_positive_whichever_way_the_bank_exported_it(self, stored):
        df = normalize_manual_signs(
            _view_rows([("7156", "2026-05-02", stored, "expense", "Bills")])
        )
        assert df["charged_amount"].iloc[0] == 8000

    @pytest.mark.parametrize("intent", ["salary", "other_income"])
    @pytest.mark.parametrize("stored", [-30000, 30000])
    def test_income_is_negative(self, intent, stored):
        df = normalize_manual_signs(_view_rows([("7156", "2026-05-04", stored, intent, None)]))
        assert df["charged_amount"].iloc[0] == -30000

    @pytest.mark.parametrize("intent", ["savings", "internal_transfer"])
    def test_transfers_keep_their_recorded_amount(self, intent):
        """Neither spend nor income — callers filter these out by intent instead."""
        df = normalize_manual_signs(_view_rows([("7156", "2026-05-05", -500, intent, None)]))
        assert df["charged_amount"].iloc[0] == -500

    def test_scraped_rows_are_untouched(self):
        df = normalize_manual_signs(_view_rows([("0887", "2026-05-01", 250, None, "Supermarket")]))
        assert df["charged_amount"].iloc[0] == 250

    def test_frame_without_the_column_passes_through(self):
        """Mock mode has no cash_flow_type."""
        df = pd.DataFrame({"charged_amount": [1.0, -2.0]})
        pd.testing.assert_frame_equal(normalize_manual_signs(df), df)


class TestSignFlipDoesNotUndoNormalization:
    """The two rules must not both fire on the same row.

    The accounts in ``sign_flipped_accounts`` hold only manual rows today, so a
    second flip after normalization would send rent straight back to negative.
    """

    @staticmethod
    def _flip(df: pd.DataFrame) -> pd.DataFrame:
        from unittest.mock import patch

        import backend.data_transactions as dt

        with patch.object(dt, "load_settings", return_value={"sign_flipped_accounts": ["7156"]}):
            return dt._apply_sign_flip(df)

    def test_normalized_expense_survives_the_flip(self):
        df = self._flip(
            normalize_manual_signs(_view_rows([("7156", "2026-05-02", -8000, "expense", "Bills")]))
        )
        assert df["charged_amount"].iloc[0] == 8000

    def test_normalized_income_survives_the_flip(self):
        df = self._flip(
            normalize_manual_signs(_view_rows([("7156", "2026-05-04", 30000, "salary", None)]))
        )
        assert df["charged_amount"].iloc[0] == -30000

    @pytest.mark.parametrize("intent", ["savings", "internal_transfer"])
    def test_unnormalized_intents_are_still_flipped(self, intent):
        """These keep the pre-existing per-account behaviour."""
        df = self._flip(_view_rows([("7156", "2026-05-05", -500, intent, None)]))
        assert df["charged_amount"].iloc[0] == 500

    def test_scraped_rows_are_still_flipped(self):
        df = self._flip(_view_rows([("7156", "2026-05-01", 250, None, "Supermarket")]))
        assert df["charged_amount"].iloc[0] == -250


def _cash_flow_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "year": [2026],
            "month": [5],
            "person": ["Gomez"],
            "account": ["7156"],
            "income": [30000],
            "expense": [8250],
            "money_transferred": [0],
            "savings": [1000],
        }
    )


class TestSankeyWithManualRows:
    def test_bank_paid_expense_reaches_the_sankey(self):
        """The rent-and-daycare regression: negative-stored manual expenses were dropped."""
        txn = normalize_manual_signs(
            _view_rows(
                [
                    ("7156", "2026-05-02", -8000, "expense", "Bills"),
                    ("0887", "2026-05-01", 250, None, "Supermarket"),
                ]
            )
        )
        result = prepare_sankey_data(txn, _cash_flow_df(), 2026)

        values = {
            lnk["target"]: lnk["value"] for lnk in result["links"] if lnk["source"] == "Income"
        }
        assert values["Bills"] == 8000
        assert values["Supermarket"] == 250

    @pytest.mark.parametrize("intent", ["savings", "internal_transfer", "salary"])
    def test_non_expense_intents_are_not_counted_as_spend(self, intent):
        txn = normalize_manual_signs(
            _view_rows(
                [
                    ("7156", "2026-05-02", 5000, intent, "Bills"),
                    ("0887", "2026-05-01", 250, None, "Supermarket"),
                ]
            )
        )
        result = prepare_sankey_data(txn, _cash_flow_df(), 2026)

        assert "Bills" not in [lnk["target"] for lnk in result["links"]]
