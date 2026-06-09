"""Simple TTL cache for data functions."""

import threading
import time
from collections.abc import Callable
from typing import Any, TypeVar

_TTL_SECONDS = 300  # 5 minutes

_cache: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()

F = TypeVar("F", bound=Callable[..., Any])


def ttl_cached(fn: F) -> F:
    """Cache the return value of a zero-argument function for _TTL_SECONDS."""
    # Qualify the key so same-named functions (or lambdas) from different
    # call sites never share a cache slot.
    key = f"{fn.__module__}.{fn.__qualname__}"

    def wrapper():
        now = time.monotonic()
        with _lock:
            entry = _cache.get(key)
            if entry is not None and now - entry[0] < _TTL_SECONDS:
                return entry[1]
        value = fn()
        with _lock:
            _cache[key] = (now, value)
        return value

    def clear() -> None:
        with _lock:
            _cache.pop(key, None)

    wrapper.__name__ = fn.__name__
    wrapper.clear = clear  # type: ignore[attr-defined]
    return wrapper  # type: ignore[return-value]


def clear_all() -> None:
    """Evict all cached entries, forcing fresh DB fetches on the next requests."""
    with _lock:
        _cache.clear()
