"""Regression tests for the business router (mock-mode, no DB required)."""

import os

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend import cache as _cache_mod  # noqa: E402
from backend.routers.business import (  # noqa: E402
    MappingItem,
    MappingsPayload,
    NewDescriptionPayload,
    create_description,
    create_mappings,
    descriptions,
    transactions_for_description,
    unmapped,
)


def test_descriptions_returns_records():
    result = descriptions()
    assert isinstance(result, list)
    assert all("description" in r for r in result)


def test_unmapped_returns_records():
    result = unmapped()
    assert isinstance(result, list)


def test_transactions_for_description_formats_dates():
    candidates = unmapped()
    if not candidates:
        return
    result = transactions_for_description(description=candidates[0]["description"])
    assert all(len(r["activity_date"]) == 10 for r in result)


def test_create_description_returns_ok():
    """POST /api/business/description must not raise AttributeError.

    Regression: _bust_caches() previously called .clear() on plain query
    functions (same bug class as #47), crashing every description creation.
    """
    result = create_description(NewDescriptionPayload(description="Test Corp"))
    assert result["ok"] is True


def test_create_mappings_returns_ok_and_flushes_cache():
    _cache_mod._cache["anything"] = (0.0, "stale")
    payload = MappingsPayload(mappings=[MappingItem(unique_id="txn-1", business_descriptions_id=1)])
    result = create_mappings(payload)
    assert result == {"ok": True, "saved": 1}
    assert "anything" not in _cache_mod._cache
