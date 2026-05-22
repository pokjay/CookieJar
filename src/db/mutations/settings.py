import json

from src.db.connection import execute_mutation, is_mock_mode


def upsert_settings(data: dict) -> None:
    if is_mock_mode():
        return
    execute_mutation(
        """
        INSERT INTO app_settings (id, data)
        VALUES (1, :data::jsonb)
        ON CONFLICT (id) DO UPDATE SET data = :data::jsonb, updated_at = NOW()
        """,
        {"data": json.dumps(data)},
    )
