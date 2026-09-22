"""Unit tests for the manual-transactions cash-flow derivation.

Pins the sign convention:

* income / expense / money_transferred are positive magnitudes, matching the
  monthly_cash_flow table and mock data — the direction is already in the
  column name;
* savings is SIGNED, because it runs both ways and the name doesn't say which:
  positive = the balance grew, negative = it shrank (#153).

Rows sit on the bank account, so savings follows the same convention as every
other intent (_INTENT_SIGN): positive charged_amount = money leaving that
account, and money leaving checking is money arriving in savings.

There used to be a second, divergent copy of this logic in backend/data.py that
negated savings — these tests guard the single consolidated implementation.
"""

from unittest.mock import patch

import pandas as pd

from src.db.queries import cash_flow as cf


def _manual_rows(rows: list[tuple[str, str, float, str]]) -> pd.DataFrame:
    """Build a transactions_manual frame from (account, date, amount, type) tuples."""
    return pd.DataFrame(
        [
            {
                "account": account,
                "activity_date": date,
                "charged_amount": amount,
                "cash_flow_type": cft,
            }
            for account, date, amount, cft in rows
        ]
    )


def _derive(rows, sign_flipped=None):
    with patch.object(cf, "run_query", return_value=_manual_rows(rows)):
        return cf._derive_cash_flow_from_manual(
            ["Leumi"], {"Leumi": "Gomez"}, sign_flipped_accounts=sign_flipped
        )


def test_income_expense_and_transfers_are_positive_magnitudes():
    result = _derive(
        [
            ("Leumi", "2025-03-01", -18000.0, "salary"),
            ("Leumi", "2025-03-05", 4200.0, "expense"),
            ("Leumi", "2025-03-10", 3000.0, "savings"),
            ("Leumi", "2025-03-15", 500.0, "internal_transfer"),
        ]
    )
    assert len(result) == 1
    row = result.iloc[0]
    assert row["year"] == 2025 and row["month"] == 3
    assert row["person"] == "Gomez"
    assert row["income"] == 18000.0
    assert row["expense"] == 4200.0
    assert row["savings"] == 3000.0
    assert row["money_transferred"] == 500.0


def test_savings_keeps_its_direction():
    """The #153 regression: taking the magnitude here made a withdrawal
    indistinguishable from a contribution, so a month the household drew its
    savings DOWN rendered as a month it saved."""
    contribution = _derive([("Leumi", "2025-03-10", 3000.0, "savings")])
    withdrawal = _derive([("Leumi", "2025-03-10", -3000.0, "savings")])

    assert contribution.iloc[0]["savings"] == 3000.0
    assert withdrawal.iloc[0]["savings"] == -3000.0


def test_savings_contributions_and_withdrawals_net_out_within_a_month():
    """Two opposite moves in one month are a small net change, not a big one —
    summing magnitudes would report 8000 of saving for a net 2000."""
    result = _derive(
        [
            ("Leumi", "2025-03-02", 5000.0, "savings"),
            ("Leumi", "2025-03-20", -3000.0, "savings"),
        ]
    )
    assert result.iloc[0]["savings"] == 2000.0


def test_a_transfer_out_of_savings_is_not_income():
    """A withdrawal must not leak into income/expense — it is neither."""
    result = _derive([("Leumi", "2025-03-10", -3000.0, "savings")])
    row = result.iloc[0]
    assert row["income"] == 0.0
    assert row["expense"] == 0.0
    assert row["money_transferred"] == 0.0


def test_sign_flipped_accounts_do_not_change_magnitudes():
    rows = [
        ("Leumi", "2025-03-01", -18000.0, "salary"),
        ("Leumi", "2025-03-05", 4200.0, "expense"),
    ]
    plain = _derive(rows)
    flipped = _derive(rows, sign_flipped=["Leumi"])
    pd.testing.assert_frame_equal(plain, flipped)


def test_rows_group_by_month_and_account():
    result = _derive(
        [
            ("Leumi", "2025-03-05", 100.0, "expense"),
            ("Leumi", "2025-03-20", 200.0, "expense"),
            ("Leumi", "2025-04-05", 50.0, "expense"),
        ]
    )
    assert len(result) == 2
    march = result[result["month"] == 3].iloc[0]
    april = result[result["month"] == 4].iloc[0]
    assert march["expense"] == 300.0
    assert april["expense"] == 50.0


def test_no_configured_accounts_returns_empty_frame():
    result = cf._derive_cash_flow_from_manual([], {})
    assert result.empty
    assert list(result.columns) == [
        "year", "month", "person", "account",
        "income", "expense", "money_transferred", "savings",
    ]


def test_backend_data_reexports_consolidated_implementation():
    """backend.data must not carry its own copy of the cash-flow pipeline."""
    from backend import data

    assert data.get_all_cash_flow is cf.get_all_cash_flow
    assert not hasattr(data, "_derive_cash_flow_from_manual")
