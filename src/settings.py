import json
from pathlib import Path

_SETTINGS_FILE = Path("config/app_settings.json")

_DEFAULTS: dict = {
    "sign_flipped_accounts": [],
    "cfg_parent1": None,
    "cfg_parent2": None,
    "cfg_kids": [],
    "account_person_mapping": {},
    "cash_flow_accounts": [],
}


def load_settings() -> dict:
    """Load persisted app settings from disk, falling back to defaults."""
    if _SETTINGS_FILE.exists():
        try:
            data = json.loads(_SETTINGS_FILE.read_text())
            return {**_DEFAULTS, **data}
        except Exception:
            pass
    return dict(_DEFAULTS)


def save_settings(settings: dict) -> None:
    """Persist app settings to disk."""
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(settings, indent=2, default=str))
