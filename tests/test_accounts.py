"""Unit tests for account-level sign normalization."""

import pandas as pd

from src.utils.accounts import apply_sign_flip


def _df(rows: list[dict]) -> pd.DataFrame:
    defaults = {"account": "Visa 1234", "charged_amount": 100.0}
    return pd.DataFrame([{**defaults, **row} for row in rows])


class TestApplySignFlip:
    def test_flips_only_configured_accounts(self):
        out = apply_sign_flip(
            _df(
                [
                    {"account": "Bank 7156", "charged_amount": 3750.0},
                    {"account": "Visa 1234", "charged_amount": 250.0},
                ]
            ),
            ["Bank 7156"],
        )
        assert out["charged_amount"].tolist() == [-3750.0, 250.0]

    def test_flip_is_symmetric_for_inflows(self):
        df = _df([{"account": "Bank 7156", "charged_amount": -40.0}])
        assert apply_sign_flip(df, ["Bank 7156"]).iloc[0]["charged_amount"] == 40.0

    def test_does_not_mutate_input(self):
        df = _df([{"account": "Bank 7156", "charged_amount": 3750.0}])
        apply_sign_flip(df, ["Bank 7156"])
        assert df.iloc[0]["charged_amount"] == 3750.0

    def test_no_configured_accounts_is_a_passthrough(self):
        df = _df([{"charged_amount": 100.0}])
        assert apply_sign_flip(df, []).iloc[0]["charged_amount"] == 100.0

    def test_unmatched_accounts_left_alone(self):
        df = _df([{"account": "Visa 1234", "charged_amount": 100.0}])
        assert apply_sign_flip(df, ["Bank 9999"]).iloc[0]["charged_amount"] == 100.0

    def test_empty_frame_is_a_passthrough(self):
        empty = pd.DataFrame(columns=["account", "charged_amount"])
        assert apply_sign_flip(empty, ["Bank 7156"]).empty

    def test_defaults_to_settings(self, monkeypatch):
        monkeypatch.setattr(
            "src.utils.accounts.load_settings",
            lambda: {"sign_flipped_accounts": ["Bank 7156"]},
        )
        out = apply_sign_flip(_df([{"account": "Bank 7156", "charged_amount": 3750.0}]))
        assert out.iloc[0]["charged_amount"] == -3750.0
