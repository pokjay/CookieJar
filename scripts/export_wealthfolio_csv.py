"""Export CookieJar transactions to Wealthfolio-importable CSVs.

Writes one CSV per account (Wealthfolio's import wizard is single-account)
plus ``rules_ranking.csv``, which ranks categorized descriptions by
transaction count so the top-N categorization rules worth recreating in
Wealthfolio are the first N rows.

    uv run python scripts/export_wealthfolio_csv.py
    uv run python scripts/export_wealthfolio_csv.py --since 2026-01-01 --account "Visa 1234"
    uv run python scripts/export_wealthfolio_csv.py --refund-type DEPOSIT --out /tmp/wf

In Wealthfolio, import each file into its matching account and map the
``comment`` column to the activity comment — that carries the description
string your categorization rules should match on. Runs against the real DB
when ``USE_MOCK_DATA=false`` (same .env as the app), sample data otherwise.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db.queries.transactions import get_all_transactions  # noqa: E402
from src.utils.wealthfolio_export import (  # noqa: E402
    REFUND_TYPES,
    account_filename,
    build_rules_ranking,
    to_wealthfolio_rows,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out",
        default="wealthfolio-export",
        help="output directory (default: wealthfolio-export/, gitignored)",
    )
    parser.add_argument("--since", help="only export transactions on/after this date (YYYY-MM-DD)")
    parser.add_argument("--until", help="only export transactions on/before this date (YYYY-MM-DD)")
    parser.add_argument(
        "--account",
        action="append",
        help="only export this account (repeatable; default: all accounts)",
    )
    parser.add_argument(
        "--refund-type",
        choices=REFUND_TYPES,
        default="CREDIT",
        help="activity type for negative amounts: CREDIT for card refunds/cashback "
        "(default), DEPOSIT for bank accounts",
    )
    args = parser.parse_args()

    df = get_all_transactions()
    if args.account:
        unknown = set(args.account) - set(df["account"])
        if unknown:
            parser.error(f"unknown account(s): {', '.join(sorted(unknown))}")
        df = df[df["account"].isin(args.account)]
    if args.since:
        df = df[df["activity_date"] >= args.since]
    if args.until:
        df = df[df["activity_date"] <= args.until]
    if df.empty:
        print("No transactions matched the given filters — nothing to export.")
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = to_wealthfolio_rows(df, refund_type=args.refund_type)
    taken: set[str] = set()
    for account, account_rows in rows.groupby("account", sort=True):
        path = out_dir / account_filename(str(account), taken)
        account_rows.drop(columns="account").to_csv(path, index=False)
        print(f"{path}  ({len(account_rows)} rows)")

    rules = build_rules_ranking(df)
    rules_path = out_dir / "rules_ranking.csv"
    rules.to_csv(rules_path, index=False)
    print(f"{rules_path}  ({len(rules)} rules, ranked by transaction count)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
