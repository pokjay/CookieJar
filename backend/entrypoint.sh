#!/bin/sh
set -e

if [ "${USE_MOCK_DATA:-true}" != "true" ] && [ -n "${DATABASE_URL}" ]; then
    .venv/bin/python /app/scripts/bootstrap_dbmate.py
    dbmate --url "$DATABASE_URL" --migrations-dir /app/db/migrations up
fi

exec "$@"
