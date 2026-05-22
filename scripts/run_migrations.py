"""Apply pending dbmate migrations, with bootstrap support for existing databases."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

sys.path.insert(0, str(Path(__file__).parent.parent))

MIGRATIONS_DIR = Path(__file__).parent.parent / "db" / "migrations"


def _bootstrap(url: str) -> None:
    """Ensure public.schema_migrations tracks the initial migration for existing databases.

    Idempotent: CREATE TABLE IF NOT EXISTS and ON CONFLICT DO NOTHING make it safe to run
    repeatedly. Only acts when the moneyman schema already exists (i.e. a pre-existing DB
    imported from moneyman); fresh databases are left untouched for dbmate to set up.
    """
    from sqlalchemy import create_engine, text

    engine = create_engine(url)
    with engine.connect() as conn:
        schema_exists = conn.execute(
            text("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'moneyman'")
        ).fetchone()
        if not schema_exists:
            return

    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS public.schema_migrations "
                "(version character varying NOT NULL, "
                "CONSTRAINT schema_migrations_pkey PRIMARY KEY (version))"
            )
        )
        result = conn.execute(
            text(
                "INSERT INTO public.schema_migrations (version) "
                "VALUES ('20260417000000') ON CONFLICT DO NOTHING"
            )
        )
    if result.rowcount > 0:
        print("Bootstrapped migration tracking for existing database.")


def _dbmate_url(url: str) -> str:
    """Prepare DATABASE_URL for dbmate.

    - Strips search_path (options=) so schema_migrations lands in public schema.
    - Defaults sslmode=disable when unset: psycopg2 tolerates no-SSL servers but
      dbmate's pq driver defaults to require for non-localhost hosts.
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params.pop("options", None)
    params.setdefault("sslmode", ["disable"])
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
