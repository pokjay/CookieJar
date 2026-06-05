"""Regression tests for the categories router (mock-mode, no DB required)."""

import os

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend.routers.categories import MappingPayload, create_mapping  # noqa: E402
from backend import cache as _cache_mod  # noqa: E402


def test_create_mapping_returns_ok():
    """POST /api/categories/mapping must succeed and not raise AttributeError.

    Regression for #47: the handler previously called .clear() on plain Python
    functions, crashing every mapping creation with AttributeError.
    """
    result = create_mapping(MappingPayload(description="STARBUCKS", category="Food", subcategory="Coffee"))
    assert result == {"ok": True}


def test_create_mapping_flushes_cache():
    """Cache entries are evicted after a mapping is created."""
    _cache_mod._cache["get_category_hierarchy"] = (0.0, {"Dummy": ["Sub"]})
    create_mapping(MappingPayload(description="X", category="Y", subcategory="Z"))
    assert "get_category_hierarchy" not in _cache_mod._cache
