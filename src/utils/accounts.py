"""Account-level normalization shared by the dashboard and the exporters.

Some banks store debits as negative and credits as positive — the opposite of
the card feeds. Which accounts those are is a per-deployment fact, so it lives
in the ``sign_flipped_accounts`` setting rather than in the view. Anything that
reads ``processed_transcations_with_categories`` directly gets raw bank signs
and must apply this before treating ``charged_amount > 0`` as "expense".
"""

from __future__ import annotations

import pandas as pd

from src.settings import load_settings


def apply_sign_flip(df: pd.DataFrame, accounts: list[str] | None = None) -> pd.DataFrame:
    """Negate ``charged_amount`` for accounts stored with reversed signs.

    ``accounts`` defaults to ``sign_flipped_accounts`` from settings. Returns
    the frame untouched when nothing matches, and never mutates the input.
    """
    if accounts is None:
        accounts = load_settings().get("sign_flipped_accounts", [])
    if not accounts or df.empty:
        return df

    mask = df["account"].isin(accounts)
    if not mask.any():
        return df

    df = df.copy()
    df.loc[mask, "charged_amount"] = -df.loc[mask, "charged_amount"]
    return df
