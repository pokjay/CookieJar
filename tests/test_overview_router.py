"""Tests for the overview router (mock-mode, no DB required)."""

import os

import pytest

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers.overview import (  # noqa: E402
    avg_monthly,
    cash_flow_monthly,
    cash_flow_yearly,
    net_worth_by_category,
    net_worth_over_time,
    summary,
    yoy_change,
)


def test_summary_shape():
    result = summary()
    assert result["total"] > 0
    assert set(result["by_person"]) == {"Gomez", "Morticia"}
    assert result["persons"] == ["Gomez", "Morticia"]
    assert result["available_years"] == [2022, 2023, 2024, 2025]
    # Per-person totals must reconcile to the grand total (approx: float summation
    # over many 2-decimal balances isn't associative).
    assert sum(result["by_person"].values()) == pytest.approx(result["total"])


def test_yoy_change_includes_overall():
    result = yoy_change(year=2024)
    assert "Overall" in result
    assert result["Overall"] is None or isinstance(result["Overall"], float)


def test_avg_monthly_positive():
    result = avg_monthly(year=2024)
    assert result["avg_income"] > 0
    assert result["avg_expense"] > 0


def test_net_worth_over_time_filters_persons():
    rows = net_worth_over_time(persons="Gomez")
    assert len(rows) > 0
    assert all(r["person"] == "Gomez" for r in rows)
    # Dates serialized as YYYY-MM-DD strings
    assert all(len(r["activity_date"]) == 10 for r in rows)


def test_net_worth_by_category_collapses_persons():
    rows = net_worth_by_category(person=None)
    assert len(rows) > 0
    keys = [(r["activity_date"], r["category"]) for r in rows]
    assert len(keys) == len(set(keys))


def test_cash_flow_endpoints_match_meta_years():
    yearly_rows = cash_flow_yearly(person=None)
    assert [r["year"] for r in yearly_rows] == [2022, 2023, 2024, 2025]
    monthly_rows = cash_flow_monthly(year=2023, person="Morticia")
    assert all(r["year"] == 2023 for r in monthly_rows)
