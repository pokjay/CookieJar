"""Regenerate the expected values used by the e2e specs from the mock data generators.

The e2e stack is seeded from the same deterministic mock generators
(``src/db/mock_data.py``), so the values asserted in the specs can be derived
instead of hardcoded. Whenever the mock data changes, re-run:

    USE_MOCK_DATA=true uv run python scripts/generate_e2e_fixtures.py

and commit the updated ``e2e/fixtures/expected-overview.json``.
"""

import json
import os
import sys
from pathlib import Path

os.environ["USE_MOCK_DATA"] = "true"

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.data import (  # noqa: E402
    get_all_cash_flow,
    get_investment_accounts_with_latest,
    get_net_worth_over_time,
)
from src.utils.calculations import (  # noqa: E402
    calculate_avg_monthly_income_expense,
    calculate_net_worth_summary,
    calculate_yoy_change,
)

OUTPUT = Path(__file__).parent.parent / "e2e" / "fixtures" / "expected-overview.json"

# Mirrors frontend/src/lib/formatting.ts


def format_currency_full(value: float) -> str:
    return f"₪{int(value + 0.5):,}"


def format_delta(value: float) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.1f}%"


def main() -> None:
    summary = calculate_net_worth_summary(get_investment_accounts_with_latest())
    cash_flow = get_all_cash_flow()
    current_year = int(cash_flow["year"].max())
    yoy = calculate_yoy_change(get_net_worth_over_time(), current_year)
    avg = calculate_avg_monthly_income_expense(cash_flow, current_year)

    expected = {
        "currentYear": str(current_year),
        "availableYears": sorted(str(y) for y in cash_flow["year"].unique()),
        "total": format_currency_full(summary["total"]),
        "byPerson": {
            person: format_currency_full(amount)
            for person, amount in summary["by_person"].items()
        },
        "delta": {
            person: format_delta(change)
            for person, change in yoy.items()
            if change is not None
        },
        "avgMonthlyIncome": format_currency_full(avg["avg_income"]),
        "avgMonthlyExpense": format_currency_full(avg["avg_expense"]),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {OUTPUT}")
    print(json.dumps(expected, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
