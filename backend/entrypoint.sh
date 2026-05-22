#!/bin/sh
set -e

use_mock=$(printf '%s' "${USE_MOCK_DATA:-true}" | tr '[:upper:]' '[:lower:]')
if [ "$use_mock" = "false" ] && [ -n "${DATABASE_URL}" ]; then
    .venv/bin/python /app/scripts/run_migrations.py
fi

exec "$@"
