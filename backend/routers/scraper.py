"""Scraper REST endpoints — bank credential vault + sync trigger."""

import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr
from pykeepass.exceptions import CredentialsError

from backend.scraper_keepass import (
    PROVIDER_SCHEMAS,
    UnknownProviderError,
    VaultAlreadyExistsError,
    VaultNotFoundError,
    add_account,
    delete_account,
    get_credentials,
    init_vault,
    is_vault_available,
    list_accounts,
    update_account,
)
from backend.scraper_sync import run_sync
from src.db.connection import is_mock_mode
from src.db.mutations.scraper import RunAlreadyRunningError, insert_run, mark_stale_runs
from src.db.queries.scraper import get_last_run, has_running_run

router = APIRouter(prefix="/scraper")

# Simple in-memory rate limiter: max 5 *failed* vault-password attempts per
# 60 s per client. Works under single-worker uvicorn (as documented). Not
# distributed-safe.
#
# Only failures count — a correct password never spends the budget, since a
# single user action (e.g. adding an account) fires multiple successful
# requests (the mutation + a list refresh) that would otherwise trip the
# limiter mid-setup. This keeps the limiter doing its actual job: slowing
# down brute-force password guessing, not penalizing normal use.
_rate_limit: dict[str, list[float]] = {}
_RATE_WINDOW = 60
_RATE_MAX = 5
# Global backstop across ALL buckets. The per-client key comes from
# X-Forwarded-For, which an authenticated client can rotate to spread failed
# attempts across fresh buckets; capping total failures per window keeps
# brute force bounded no matter how the key is spoofed (and bounds the
# number of buckets a spoofer can create).
_RATE_MAX_GLOBAL = 15


def _client_ip(request: Request) -> str:
    """Resolve the rate-limit bucket key for this request.

    All browser traffic reaches this API via the Next.js server-side proxy
    (frontend/src/app/api/[...proxy]/route.ts), so request.client.host is
    always the frontend container's IP, not the real client's. The proxy
    forwards the real client IP via X-Forwarded-For; prefer its first hop
    when present and fall back to request.client.host otherwise.
    """
    headers = getattr(request, "headers", None)
    forwarded = headers.get("x-forwarded-for") if headers is not None else None
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _prune(key: str, now: float) -> list[float]:
    """Return key's non-expired hit timestamps, dropping the bucket entirely
    once it's empty so the dict doesn't grow unboundedly."""
    hits = [t for t in _rate_limit.get(key, []) if now - t < _RATE_WINDOW]
    if hits:
        _rate_limit[key] = hits
    else:
        _rate_limit.pop(key, None)
    return hits


def _total_failed_attempts(now: float) -> int:
    """Total non-expired failed attempts across all buckets (pruning as it goes)."""
    return sum(len(_prune(key, now)) for key in list(_rate_limit))


def _check_rate_limit(request: Request) -> None:
    """Raise 429 if this client already has _RATE_MAX+ failed vault-password
    attempts within the last _RATE_WINDOW seconds, or _RATE_MAX_GLOBAL+ failed
    attempts exist across all clients (anti-spoofing backstop).

    This only checks the buckets — it never adds to them. Only
    _record_failed_attempt() (called from each endpoint's wrong-password
    branch) grows them.
    """
    key = _client_ip(request)
    now = time.monotonic()
    hits = _prune(key, now)
    if len(hits) >= _RATE_MAX or _total_failed_attempts(now) >= _RATE_MAX_GLOBAL:
        raise HTTPException(status_code=429, detail="Too many vault attempts. Try again later.")


def _record_failed_attempt(request: Request) -> None:
    """Record a failed vault-password attempt against the rate-limit bucket."""
    key = _client_ip(request)
    now = time.monotonic()
    hits = _prune(key, now)
    hits.append(now)
    _rate_limit[key] = hits


def _mock_guard() -> None:
    """Sync needs a real database; vault management is pure file I/O and stays available."""
    if is_mock_mode():
        raise HTTPException(status_code=503, detail="Sync unavailable in mock mode.")


# ── Models ────────────────────────────────────────────────────────────────────


class InitPayload(BaseModel):
    db_password: SecretStr


class ListPayload(BaseModel):
    db_password: SecretStr


class AddAccountPayload(BaseModel):
    title: str
    provider: str
    credential_fields: dict[str, str]
    db_password: SecretStr


class UpdateAccountPayload(BaseModel):
    db_password: SecretStr
    title: str | None = None
    provider: str | None = None
    credential_fields: dict[str, str] | None = None


class DeleteAccountPayload(BaseModel):
    db_password: SecretStr


class SyncPayload(BaseModel):
    db_password: SecretStr
    lookback_days: int = Field(..., ge=1, le=90)


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/init")
def scraper_init(payload: InitPayload, request: Request) -> dict:
    _check_rate_limit(request)
    try:
        init_vault(payload.db_password.get_secret_value())
    except VaultAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Vault already exists.")
    return {"ok": True}


@router.post("/accounts/list")
def scraper_list_accounts(payload: ListPayload, request: Request) -> list[dict]:
    _check_rate_limit(request)
    try:
        return list_accounts(payload.db_password.get_secret_value())
    except VaultNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CredentialsError:
        _record_failed_attempt(request)
        raise HTTPException(status_code=401, detail="Wrong vault password.")


@router.post("/accounts")
def scraper_add_account(payload: AddAccountPayload, request: Request) -> dict:
    _check_rate_limit(request)
    try:
        uid = add_account(
            title=payload.title,
            provider=payload.provider,
            credential_fields=payload.credential_fields,
            db_password=payload.db_password.get_secret_value(),
        )
    except VaultNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CredentialsError:
        _record_failed_attempt(request)
        raise HTTPException(status_code=401, detail="Wrong vault password.")
    except UnknownProviderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True, "uuid": uid}


@router.put("/accounts/{uuid}")
def scraper_update_account(uuid: str, payload: UpdateAccountPayload, request: Request) -> dict:
    _check_rate_limit(request)
    try:
        update_account(
            uuid_str=uuid,
            db_password=payload.db_password.get_secret_value(),
            title=payload.title,
            provider=payload.provider,
            credential_fields=payload.credential_fields,
        )
    except VaultNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CredentialsError:
        _record_failed_attempt(request)
        raise HTTPException(status_code=401, detail="Wrong vault password.")
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {uuid} not found.")
    except UnknownProviderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True}


@router.delete("/accounts/{uuid}")
def scraper_delete_account(uuid: str, payload: DeleteAccountPayload, request: Request) -> dict:
    _check_rate_limit(request)
    try:
        delete_account(uuid_str=uuid, db_password=payload.db_password.get_secret_value())
    except VaultNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CredentialsError:
        _record_failed_attempt(request)
        raise HTTPException(status_code=401, detail="Wrong vault password.")
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Account {uuid} not found.")
    return {"ok": True}


@router.post("/sync")
def scraper_sync(
    payload: SyncPayload,
    background_tasks: BackgroundTasks,
    request: Request,
) -> dict:
    _mock_guard()
    _check_rate_limit(request)

    # Clear any stale 'running' row (crashed/killed previous run) at trigger
    # time, not just at boot — otherwise a stuck run blocks every /sync with
    # 409 until the backend happens to restart.
    mark_stale_runs()

    if has_running_run():
        raise HTTPException(status_code=409, detail="A sync is already running.")

    # Validate password and extract credentials synchronously before dispatching.
    # This ensures a wrong password returns 401 immediately, not via polling.
    try:
        credentials = get_credentials(payload.db_password.get_secret_value())
    except VaultNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CredentialsError:
        _record_failed_attempt(request)
        raise HTTPException(status_code=401, detail="Wrong vault password.")

    if not credentials:
        raise HTTPException(status_code=422, detail="No accounts in vault.")

    # has_running_run() above is a cheap pre-check, not an atomic guard — a
    # concurrent request can race past it too. insert_run() relies on the DB's
    # partial unique index as the real guard and raises RunAlreadyRunningError
    # if this request lost the race, which we map to the same 409 here.
    try:
        run_id = insert_run(payload.lookback_days)
    except RunAlreadyRunningError:
        raise HTTPException(status_code=409, detail="A sync is already running.")
    background_tasks.add_task(run_sync, credentials, run_id, payload.lookback_days)
    return {"run_id": run_id}


@router.get("/status")
def scraper_status() -> dict[str, Any]:
    """Last run info + vault availability.

    Not cached (no @ttl_cached), unlike other data endpoints in this codebase:
    SyncButton.tsx polls this every 3s to show live sync progress, so a 5-minute
    TTL cache would show a stale "running" state well after a sync finishes.
    """
    return {
        "vault_available": is_vault_available(),
        "is_running": has_running_run() if not is_mock_mode() else False,
        "last_run": get_last_run(),
        "providers": list(PROVIDER_SCHEMAS.keys()),
    }
