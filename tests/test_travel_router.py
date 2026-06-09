"""Tests for the travel router (mock-mode, no DB required)."""

import os

import pytest

os.environ.setdefault("USE_MOCK_DATA", "true")

import src.settings as settings_mod  # noqa: E402
from backend.routers.travel import (  # noqa: E402
    TripNamePayload,
    browse,
    browse_meta,
    dashboard_meta,
    dashboard_trips,
    dashboard_yoy_spend,
    set_trip_name,
)


@pytest.fixture(autouse=True)
def _reset_memory_settings():
    yield
    settings_mod._memory_settings = None


def test_browse_meta_shape():
    result = browse_meta()
    assert len(result["subcategories"]) > 0
    assert len(result["date_min"]) == 10
    assert result["amount_min"] <= result["amount_max"]


def test_browse_rows_are_json_safe():
    rows = browse()
    assert len(rows) > 0
    for row in rows:
        for v in row.values():
            # NaN must be scrubbed to None
            assert v is None or v == v


def test_dashboard_meta_lists_years():
    result = dashboard_meta()
    assert len(result["available_years"]) > 0


def test_yoy_spend_returns_rows():
    rows = dashboard_yoy_spend()
    assert isinstance(rows, list)


def test_trip_naming_roundtrip():
    trips = dashboard_trips()
    assert len(trips) > 0
    start = trips[0]["start_date"]

    set_trip_name(start, TripNamePayload(name="Paris"))
    named = next(t for t in dashboard_trips() if t["start_date"] == start)
    assert named["name"] == "Paris"

    set_trip_name(start, TripNamePayload(name=None))
    unnamed = next(t for t in dashboard_trips() if t["start_date"] == start)
    assert unnamed["name"] is None
