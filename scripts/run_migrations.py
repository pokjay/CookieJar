"""Apply pending dbmate migrations, with bootstrap support for existing databases."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

sys.path.insert(0, str(Path(__file__).parent.parent))

MIGRATIONS_DIR = Path(__file__).parent.parent / "db" / "migrations"


def _bootstrap(url: str) -> None:
    """Create migration tracking for pre-existing databases (e.g. moneyman imports)."""
    from sqlalchemy import create_engine, text

    engine = create_engine(url)
    with engine.connect() as conn:
        schema_exists = conn.execute(
            text("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'moneyman'")
        ).fetchone()
        if not schema_exists:
            return

        migrations_tracked = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'schema_migrations' "
                "AND table_schema IN ('public', 'moneyman')"
            )
        ).fetchone()
        if migrations_tracked:
            return

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


def _dbmate_url(url: str) -> str:
    """Strip search_path from DATABASE_URL for dbmate.

    Migrations set search_path explicitly; without this dbmate would create
    its schema_migrations table in moneyman (which doesn't exist on a fresh DB).
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params.pop("options", None)
    return urlunparse(parsed._replace(query=urlencode({k: v[0] for k, v in params.items()})))


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return

    _bootstrap(url)

    dbmate_url = _dbmate_url(url)
    result = subprocess.run(
        [
            "dbmate",
            "--url", dbmate_url,
            "--migrations-dir", str(MIGRATIONS_DIR),
            "--no-dump-schema",
            "up",
        ],
        check=False,
        env={**os.environ, "DATABASE_URL": dbmate_url},
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
