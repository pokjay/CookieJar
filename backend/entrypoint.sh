#!/bin/sh
set -e

if [ "${USE_MOCK_DATA:-true}" != "true" ] && [ -n "${DATABASE_URL}" ]; then
    .venv/bin/python /app/scripts/run_migrations.py
fi

exec "$@"
