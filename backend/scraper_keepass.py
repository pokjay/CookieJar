"""KeePass vault operations for scraper bank credentials.

The vault is a dedicated .kdbx file containing only bank credentials for this
app. It is opened per-request with the user-supplied password and closed
immediately after — never held open persistently.

All operations acquire _vault_lock, which also covers reads to prevent partial-
file reads during an in-progress atomic write. Writes are saved atomically via
a .tmp intermediate and a .bak of the prior version.
"""

import os
import shutil
import threading
from pathlib import Path
from typing import Any

from pykeepass import PyKeePass, create_database

VAULT_PATH = Path(os.getenv("KEEPASS_VAULT_PATH", "/data/keepass/cookiejar_bank.kdbx"))

# Supported providers and their required credential fields.
PROVIDER_SCHEMAS: dict[str, list[str]] = {
    "isracard": ["id", "card6Digits", "password"],
    "visaCal": ["username", "password"],
    "max": ["username", "password"],
    "amex": ["id", "card6Digits", "password"],
}

_vault_lock = threading.Lock()


class VaultAlreadyExistsError(Exception):
    pass


class VaultNotFoundError(Exception):
    pass


class UnknownProviderError(Exception):
    pass


def _atomic_save(kp: PyKeePass) -> None:
    tmp = VAULT_PATH.with_suffix(".kdbx.tmp")
    bak = VAULT_PATH.with_suffix(".kdbx.bak")
    kp.save(filename=str(tmp))
    if VAULT_PATH.exists():
        shutil.copy2(VAULT_PATH, bak)
    tmp.replace(VAULT_PATH)


def is_vault_available() -> bool:
    return VAULT_PATH.exists()


def init_vault(db_password: str) -> None:
    """Create the vault. Raises VaultAlreadyExistsError if it already exists."""
    with _vault_lock:
        if VAULT_PATH.exists():
            raise VaultAlreadyExistsError(f"Vault already exists at {VAULT_PATH}")
        VAULT_PATH.parent.mkdir(parents=True, exist_ok=True)
        create_database(str(VAULT_PATH), password=db_password)


def _open(db_password: str) -> PyKeePass:
    """Open the vault. Caller must hold _vault_lock."""
    if not VAULT_PATH.exists():
        raise VaultNotFoundError("Vault not initialised. Call /api/scraper/init first.")
    return PyKeePass(str(VAULT_PATH), password=db_password)


def list_accounts(db_password: str) -> list[dict[str, Any]]:
    """Return account metadata (no passwords)."""
    with _vault_lock:
        kp = _open(db_password)
        result = []
        for entry in kp.entries:
            result.append(
                {
                    "uuid": str(entry.uuid),
                    "title": entry.title,
                    "provider": entry.get_custom_property("provider") or "",
                    "field_names": [k for k in (entry.custom_properties or {}) if k != "provider"],
                }
            )
        return result


def get_credentials(db_password: str) -> list[dict[str, Any]]:
    """Return full credentials for sync. Keep this result short-lived.

    Carries the same "uuid" as list_accounts() so a caller can narrow a sync to
    specific accounts (see _select_accounts in backend/routers/scraper.py).
    Titles can't serve that purpose: they are neither unique nor stable across
    a rename, and selecting the wrong entry here means scraping the wrong bank.
    """
    with _vault_lock:
        kp = _open(db_password)
        result = []
        for entry in kp.entries:
            provider = entry.get_custom_property("provider") or ""
            custom = entry.custom_properties or {}
            credentials = {k: v for k, v in custom.items() if k != "provider"}
            result.append(
                {
                    "uuid": str(entry.uuid),
                    "companyId": provider,
                    "accountTitle": entry.title,
                    "credentials": credentials,
                }
            )
        return result


def add_account(
    title: str,
    provider: str,
    credential_fields: dict[str, str],
    db_password: str,
) -> str:
    """Add an account entry. Returns the new entry UUID."""
    if provider not in PROVIDER_SCHEMAS:
        raise UnknownProviderError(f"Unknown provider: {provider!r}")
    with _vault_lock:
        kp = _open(db_password)
        entry = kp.add_entry(kp.root_group, title, username="", password="")
        entry.set_custom_property("provider", provider)
        for key, value in credential_fields.items():
            entry.set_custom_property(key, value)
        _atomic_save(kp)
        return str(entry.uuid)


def update_account(
    uuid_str: str,
    db_password: str,
    title: str | None = None,
    provider: str | None = None,
    credential_fields: dict[str, str] | None = None,
) -> None:
    """Update an account entry by UUID."""
    with _vault_lock:
        kp = _open(db_password)
        entries = [e for e in kp.entries if str(e.uuid) == uuid_str]
        if not entries:
            raise KeyError(f"No entry with uuid {uuid_str}")
        entry = entries[0]
        if title is not None:
            entry.title = title
        if provider is not None:
            if provider not in PROVIDER_SCHEMAS:
                raise UnknownProviderError(f"Unknown provider: {provider!r}")
            entry.set_custom_property("provider", provider)
        if credential_fields is not None:
            existing = list(entry.custom_properties or {})
            for key in existing:
                if key != "provider":
                    entry.delete_custom_property(key)
            for key, value in credential_fields.items():
                entry.set_custom_property(key, value)
        _atomic_save(kp)


def delete_account(uuid_str: str, db_password: str) -> None:
    """Delete an account entry by UUID."""
    with _vault_lock:
        kp = _open(db_password)
        entries = [e for e in kp.entries if str(e.uuid) == uuid_str]
        if not entries:
            raise KeyError(f"No entry with uuid {uuid_str}")
        kp.delete_entry(entries[0])
        _atomic_save(kp)
