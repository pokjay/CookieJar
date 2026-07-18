"""Transform CookieJar transactions into Wealthfolio-importable CSV rows.

Wealthfolio's CSV import wizard is single-account, so the export is grouped
into one frame per CookieJar account. Output columns match the wizard's
mappable fields for cash activities: ``date``, ``activityType``, ``amount``
(always positive), ``currency``, and ``comment``.

The ``comment`` column carries ``processed_description`` — the same string
CookieJar's ``description_to_category`` mapping keys on — so categorization
rules recreated in Wealthfolio match the exact text CookieJar categorized.

Sign convention: ``processed_transcations_with_categories`` stores expenses
as positive ``charged_amount`` and refunds/cashback as negative.
"""

import re

import pandas as pd

DEFAULT_CURRENCY = "ILS"
EXPENSE_TYPE = "WITHDRAWAL"
REFUND_TYPES = ("CREDIT", "DEPOSIT")

EXPORT_COLUMNS = ["date", "activityType", "amount", "currency", "comment"]
RULES_COLUMNS = [
    "processed_description",
    "category",
    "subcategory",
    "txn_count",
    "total_amount",
    "cumulative_txn_pct",
]


def to_wealthfolio_rows(df: pd.DataFrame, refund_type: str = "CREDIT") -> pd.DataFrame:
    """Map CookieJar transactions to Wealthfolio import rows.

    Drops pending and zero-amount rows. Expenses (positive ``charged_amount``)
    become ``WITHDRAWAL``; refunds/cashback (negative) become ``refund_type``
    (``CREDIT`` for card accounts, ``DEPOSIT`` for bank accounts). Keeps the
    ``account`` column so callers can split the result into per-account files.
    """
    if refund_type not in REFUND_TYPES:
        raise ValueError(f"refund_type must be one of {REFUND_TYPES}, got {refund_type!r}")

    df = df[df["status"].str.lower().ne("pending") & df["charged_amount"].ne(0)].copy()

    comment = df["processed_description"]
    if "description" in df.columns:
        comment = comment.fillna(df["description"])

    activity_type = df["charged_amount"].gt(0).map({True: EXPENSE_TYPE, False: refund_type})

    out = pd.DataFrame(
        {
            "account": df["account"],
            "date": pd.to_datetime(df["activity_date"]).dt.strftime("%Y-%m-%d"),
            "activityType": activity_type,
            "amount": df["charged_amount"].abs(),
            "currency": df["charged_currency"].fillna(DEFAULT_CURRENCY),
            "comment": comment,
        }
    )
    return out.sort_values("date").reset_index(drop=True)


def build_rules_ranking(df: pd.DataFrame) -> pd.DataFrame:
    """Rank categorized descriptions by transaction count.

    Returns one row per (processed_description, category, subcategory) with
    ``txn_count``, ``total_amount`` (absolute), and ``cumulative_txn_pct`` —
    so the top-N rules worth recreating in Wealthfolio are the first N rows.
    """
    categorized = df[df["category"].notna()].copy()
    if categorized.empty:
        return pd.DataFrame(columns=RULES_COLUMNS)

    categorized["subcategory"] = categorized["subcategory"].fillna("")
    categorized["abs_amount"] = categorized["charged_amount"].abs()
    ranked = (
        categorized.groupby(["processed_description", "category", "subcategory"], dropna=False)
        .agg(txn_count=("processed_description", "size"), total_amount=("abs_amount", "sum"))
        .reset_index()
        .sort_values(["txn_count", "total_amount"], ascending=False)
        .reset_index(drop=True)
    )
    ranked["cumulative_txn_pct"] = (
        ranked["txn_count"].cumsum() / ranked["txn_count"].sum() * 100
    ).round(1)
    return ranked[RULES_COLUMNS]


def account_filename(account: str, taken: set[str]) -> str:
    """Sanitize an account name into a unique CSV filename."""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", account).strip("_") or "account"
    name = f"{stem}.csv"
    suffix = 2
    while name in taken:
        name = f"{stem}_{suffix}.csv"
        suffix += 1
    taken.add(name)
    return name
