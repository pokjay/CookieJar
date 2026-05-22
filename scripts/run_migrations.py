"""Apply pending dbmate migrations, with bootstrap support for existing databases."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

sys.path.insert(0, str(Path(__file__).parent.parent))

MIGRATIONS_DIR = Path(__file__).parent.parent / "db" / "migrations"


def _bootstrap(url: str) -> None:
    """Prepare a fresh or pre-existing database for dbmate.

    dbmate stores its schema_migrations table in the moneyman schema (that is the
    connection's search_path — see _dbmate_url). Two preconditions must hold before
    dbmate runs:

    - The moneyman schema must exist so dbmate can create schema_migrations there.
      A fresh database has no moneyman schema yet, so create it; the initial
      migration uses CREATE SCHEMA IF NOT EXISTS so it stays compatible.
    - A database imported from moneyman before this app managed migrations already
      has the initial schema objects. Detect that (moneyman.transactions present)
      and record the initial migration as applied so dbmate does not try to
      re-create objects that already exist.

    schema_migrations lives in the moneyman schema, not public: the app's DB role
    owns the moneyman schema but may lack CREATE on public (PostgreSQL 15+ locks
    public down for non-owners).

    Idempotent: safe to run on every startup.
    """
    from sqlalchemy import create_engine, text

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS moneyman"))
        imported = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'moneyman' AND table_name = 'transactions'"
            )
        ).fetchone()
        if not imported:
            return  # Fresh DB — dbmate applies every migration from scratch.

        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS moneyman.schema_migrations "
                "(version character varying NOT NULL, "
                "CONSTRAINT schema_migrations_pkey PRIMARY KEY (version))"
            )
        )
        result = conn.execute(
            text(
                "INSERT INTO moneyman.schema_migrations (version) "
                "VALUES ('20260417000000') ON CONFLICT DO NOTHING"
            )
        )
        bootstrapped = result.rowcount > 0
    if bootstrapped:
        print("Bootstrapped migration tracking for existing database.")


def _dbmate_url(url: str) -> str:
    """Prepare DATABASE_URL for dbmate.

    - Pins search_path to moneyman via options=. dbmate stores its schema_migrations
      table in the first schema on the connection's search_path; pinning it keeps
      that deterministic regardless of the DB role name. PostgreSQL's default
      search_path includes "$user", so a role named after a schema (e.g. a
      'moneyman' role) would otherwise silently redirect tracking — and merely
      stripping the caller's options= leaves exactly that default in place.
    - Defaults sslmode=disable when unset: psycopg2 tolerates no-SSL servers but
      dbmate's pq driver defaults to require for non-localhost hosts.
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params["options"] = ["-csearch_path=moneyman"]
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
