from src.db.connection import is_mock_mode

_DEFAULTS: dict = {
    "sign_flipped_accounts": [],
    "cfg_parent1": None,
    "cfg_parent2": None,
    "cfg_kids": [],
    "account_person_mapping": {},
    "cash_flow_accounts": [],
}

_memory_settings: dict | None = None


def load_settings() -> dict:
    if is_mock_mode():
        if _memory_settings is None:
            return dict(_DEFAULTS)
        return {**_DEFAULTS, **_memory_settings}
    from src.db.queries.settings import get_settings

    return {**_DEFAULTS, **get_settings()}


def save_settings(settings: dict) -> None:
    global _memory_settings
    if is_mock_mode():
        _memory_settings = dict(settings)
        return
    from src.db.mutations.settings import upsert_settings

    upsert_settings(settings)
