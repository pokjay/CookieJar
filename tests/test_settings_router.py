"""Regression tests for the settings router cache busting.

Same class of bug as #47 (categories router): the reset endpoints used to call
``.clear()`` on plain query functions, crashing with AttributeError after the
DELETE had already run.
"""

import os
from unittest.mock import patch

import pandas as pd

os.environ.setdefault("USE_MOCK_DATA", "true")

from backend import cache as _cache_mod  # noqa: E402
from backend.routers import settings as settings_router  # noqa: E402


def _count_df(n: int) -> pd.DataFrame:
    return pd.DataFrame({"cnt": [n]})


def test_reset_category_mappings_does_not_crash_and_flushes_cache():
    _cache_mod._cache["anything"] = (0.0, "stale")
    with (
        patch.object(settings_router, "is_mock_mode", return_value=False),
        patch("src.db.connection.run_query", return_value=_count_df(3)),
        patch.object(settings_router, "execute_mutation") as mutation,
    ):
        result = settings_router.reset_category_mappings()
    assert result == {"ok": True, "deleted": 3}
    mutation.assert_called_once()
    assert "anything" not in _cache_mod._cache


def test_reset_business_mappings_flushes_cache():
    _cache_mod._cache["anything"] = (0.0, "stale")
    with (
        patch.object(settings_router, "is_mock_mode", return_value=False),
        patch("src.db.connection.run_query", return_value=_count_df(2)),
        patch.object(settings_router, "execute_mutation"),
    ):
        result = settings_router.reset_business_mappings()
    assert result == {"ok": True, "deleted": 2}
    assert "anything" not in _cache_mod._cache


def test_ttl_cached_wrapper_exposes_clear():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        return calls["n"]

    cached = _cache_mod.ttl_cached(fn)
    assert cached() == 1
    assert cached() == 1
    cached.clear()
    assert cached() == 2
