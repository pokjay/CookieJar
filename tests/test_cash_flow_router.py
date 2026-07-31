"""Tests for the cash-flow router (mock-mode, no DB required)."""

import os

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers.cash_flow import (  # noqa: E402
    meta,
    monthly,
    monthly_by_account,
    sankey,
    yearly,
)


def test_meta_lists_persons_and_years():
    result = meta()
    assert result["persons"] == ["Gomez", "Morticia"]
    assert result["available_years"] == [2022, 2023, 2024, 2025]


def test_meta_lists_available_months_in_order():
    months = meta()["available_months"]
    assert months == sorted(months)
    assert months[0] == "2022-01"
    assert all(len(m) == 7 and m[4] == "-" for m in months)


def test_yearly_aggregates_all_years():
    rows = yearly(person=None)
    assert [r["year"] for r in rows] == [2022, 2023, 2024, 2025]
    for r in rows:
        assert r["income"] > 0
        assert r["expense"] > 0
        assert r["income_expense_diff"] == r["income"] - r["expense"]


def test_yearly_person_filter_reduces_totals():
    household = {r["year"]: r["income"] for r in yearly(person=None)}
    gomez = {r["year"]: r["income"] for r in yearly(person="Gomez")}
    for year, income in gomez.items():
        assert 0 < income < household[year]


def test_monthly_returns_month_names():
    rows = monthly(year=2024, person=None)
    assert [r["month"] for r in rows] == list(range(1, 13))
    assert rows[0]["month_name"] == "Jan"
    assert all(r["year"] == 2024 for r in rows)


def test_monthly_by_account_groups_by_account():
    rows = monthly_by_account(year=2024, person=None)
    accounts = {r["account"] for r in rows}
    assert accounts == {"Bank Leumi", "Discount", "Mizrahi"}


def test_sankey_builds_income_links():
    result = sankey(year=2024, person=None, expanded=None, month=None)
    assert {n["name"] for n in result["nodes"]} >= {"Income"}
    assert all(lnk["value"] >= 0 for lnk in result["links"])


def test_sankey_month_scope_is_a_subset_of_the_year():
    year = sankey(year=2024, person=None, expanded=None, month=None)
    march = sankey(year=2024, person=None, expanded=None, month=3)

    def income_total(result):
        return sum(lnk["value"] for lnk in result["links"] if lnk["source"] == "Income")

    assert income_total(march) > 0
    assert income_total(march) < income_total(year)
