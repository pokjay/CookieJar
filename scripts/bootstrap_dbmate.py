"""Bootstrap dbmate migration tracking for existing databases."""

import os
import sys

sys.path.insert(0, "/app")


def main() -> None:
    from sqlalchemy import create_engine, text

    url = os.getenv("DATABASE_URL")
    if not url:
        return

    engine = create_engine(url)
    with engine.connect() as conn:
        schema_exists = conn.execute(
            text(
                "SELECT 1 FROM information_schema.schemata "
                "WHERE schema_name = 'moneyman'"
            )
        ).fetchone()
        if not schema_exists:
            return  # Fresh DB — dbmate handles it from scratch

        migrations_tracked = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'schema_migrations' "
                "AND table_schema IN ('public', 'moneyman')"
            )
        ).fetchone()
        if migrations_tracked:
            return  # Already tracked — nothing to do

    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS public.schema_migrations "
                "(version character varying NOT NULL, "
                "CONSTRAINT schema_migrations_pkey PRIMARY KEY (version))"
            )
        )
        conn.execute(
            text(
                "INSERT INTO public.schema_migrations (version) "
                "VALUES ('20260417000000') ON CONFLICT DO NOTHING"
            )
        )
    print("Bootstrapped migration tracking for existing database.")


if __name__ == "__main__":
    main()
