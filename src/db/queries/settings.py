import json
import math

from src.db.connection import is_mock_mode, run_query


def get_settings() -> dict:
    if is_mock_mode():
        return {}
    df = run_query("SELECT data FROM app_settings WHERE id = 1")
    if df.empty:
        return {}
    value = df["data"].iloc[0]
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return {}
    if isinstance(value, str):
        return json.loads(value)
    if isinstance(value, dict):
        return value
    return {}
