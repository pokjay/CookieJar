"""Scraper REST endpoints — bank credential vault + sync trigger."""

import collections
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
from src.db.mutations.scraper import insert_run
from src.db.queries.scraper import get_last_run, has_running_run

router = APIRouter(prefix="/scraper")

# Simple in-memory rate limiter: max 5 vault-opens per 60 s per client IP.
# Works under single-worker uvicorn (as documented). Not distributed-safe.
_rate_limit: dict[str, list[float]] = collections.defaultdict(list)
_RATE_WINDOW = 60
_RATE_MAX = 5


def _check_rate_limit(request: Request) -> None:
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    hits = [t for t in _rate_limit[client] if now - t < _RATE_WINDOW]
    if len(hits) >= _RATE_MAX:
        raise HTTPException(status_code=429, detail="Too many vault attempts. Try again later.")
    hits.append(now)
    _rate_limit[client] = hits


def _mock_guard() -> None:
    """Sync needs a real database; vault management is pure file I/O and stays available."""
    if is_mock_mode():
        raise HTTPException(status_code=503, detail="Sync unavailable in mock mode.")


def _vault_open_or_404(db_password: str) -> None:
    """Attempt to open the vault — raises 401 on wrong password, 404 if missing."""
    try:
        from backend.scraper_keepass import _open, _vault_lock
        with _vault_lock:
            _open(db_password)
    except VaultNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CredentialsError as exc:
        raise HTTPException(status_code=401, detail="Wrong vault password.") from exc


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

    if has_running_run():
        raise HTTPException(status_code=409, detail="A sync is already running.")

    # Validate password and extract credentials synchronously before dispatching.
    # This ensures a wrong password returns 401 immediately, not via polling.
    try:
        credentials = get_credentials(payload.db_password.get_secret_value())
    except VaultNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CredentialsError:
        raise HTTPException(status_code=401, detail="Wrong vault password.")

    if not credentials:
        raise HTTPException(status_code=422, detail="No accounts in vault.")

    run_id = insert_run(payload.lookback_days)
    background_tasks.add_task(run_sync, credentials, run_id, payload.lookback_days)
    return {"run_id": run_id}


@router.get("/status")
def scraper_status() -> dict[str, Any]:
    """Last run info + vault availability. Never cached."""
    return {
        "vault_available": is_vault_available(),
        "is_running": has_running_run() if not is_mock_mode() else False,
        "last_run": get_last_run(),
        "providers": list(PROVIDER_SCHEMAS.keys()),
    }
