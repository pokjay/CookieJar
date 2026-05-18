"""Simple TTL cache for data functions."""

import time
from collections.abc import Callable
from typing import Any, TypeVar

_TTL_SECONDS = 300  # 5 minutes

_cache: dict[str, tuple[float, Any]] = {}

F = TypeVar("F", bound=Callable[..., Any])


def ttl_cached(fn: F) -> F:
    """Cache the return value of a zero-argument function for _TTL_SECONDS."""

    def wrapper():
        now = time.monotonic()
        entry = _cache.get(fn.__name__)
        if entry is None or now - entry[0] >= _TTL_SECONDS:
            _cache[fn.__name__] = (now, fn())
        return _cache[fn.__name__][1]

    wrapper.__name__ = fn.__name__
    return wrapper  # type: ignore[return-value]


def clear_all() -> None:
    """Evict all cached entries, forcing fresh DB fetches on the next requests."""
    _cache.clear()
