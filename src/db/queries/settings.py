from src.db.connection import run_query


def get_settings() -> dict:
    df = run_query("SELECT data FROM app_settings WHERE id = 1")
    if df.empty:
        return {}
    return df["data"].iloc[0]
