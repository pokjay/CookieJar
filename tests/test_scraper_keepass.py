"""Tests for backend/scraper_keepass.py — in particular that update_account()
does not leave stale credential fields behind when an account's provider
changes (e.g. isracard's id/card6Digits lingering after switching to visaCal,
which get_credentials() would then forward to the scraper as bogus fields).
"""

import json
from pathlib import Path

import pytest
from pykeepass import create_database

from backend import scraper_keepass


def test_provider_schemas_match_shared_manifest():
    """scraper/providers.json is the shared manifest binding PROVIDER_SCHEMAS to
    the JS-side drift guard (scraper/test/providers.test.js, which checks the
    manifest against israeli-bank-scrapers' CompanyTypes/loginFields). If this
    fails, one side gained/changed a provider without the other."""
    manifest_path = Path(__file__).resolve().parents[1] / "scraper" / "providers.json"
    manifest = json.loads(manifest_path.read_text())
    assert manifest == scraper_keepass.PROVIDER_SCHEMAS


@pytest.fixture
def vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    vault_path = tmp_path / "test_vault.kdbx"
    create_database(str(vault_path), password="master-pw")
    monkeypatch.setattr(scraper_keepass, "VAULT_PATH", vault_path)
    return vault_path


def test_update_account_provider_change_removes_stale_credential_fields(vault: Path):
    uuid_str = scraper_keepass.add_account(
        title="My Isracard",
        provider="isracard",
        credential_fields={"id": "123456789", "card6Digits": "123456", "password": "secret"},
        db_password="master-pw",
    )

    scraper_keepass.update_account(
        uuid_str,
        db_password="master-pw",
        provider="visaCal",
        credential_fields={"username": "myuser", "password": "newsecret"},
    )

    accounts = scraper_keepass.list_accounts("master-pw")
    assert len(accounts) == 1
    account = accounts[0]
    assert account["provider"] == "visaCal"
    assert sorted(account["field_names"]) == ["password", "username"]

    creds = scraper_keepass.get_credentials("master-pw")
    assert len(creds) == 1
    assert creds[0]["companyId"] == "visaCal"
    assert creds[0]["credentials"] == {"username": "myuser", "password": "newsecret"}


def test_update_account_title_only_leaves_credential_fields_untouched(vault: Path):
    uuid_str = scraper_keepass.add_account(
        title="My Isracard",
        provider="isracard",
        credential_fields={"id": "123456789", "card6Digits": "123456", "password": "secret"},
        db_password="master-pw",
    )

    scraper_keepass.update_account(
        uuid_str,
        db_password="master-pw",
        title="Renamed Account",
    )

    accounts = scraper_keepass.list_accounts("master-pw")
    assert len(accounts) == 1
    account = accounts[0]
    assert account["title"] == "Renamed Account"
    assert account["provider"] == "isracard"
    assert sorted(account["field_names"]) == ["card6Digits", "id", "password"]

    creds = scraper_keepass.get_credentials("master-pw")
    assert creds[0]["credentials"] == {
        "id": "123456789",
        "card6Digits": "123456",
        "password": "secret",
    }
