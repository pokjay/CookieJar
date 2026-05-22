FROM ghcr.io/amacneil/dbmate:2 AS dbmate

FROM python:3.12.9-slim

RUN adduser --disabled-password --gecos '' --uid 1000 appuser

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY --from=dbmate /usr/local/bin/dbmate /usr/local/bin/dbmate

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY src/ ./src/
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY db/ ./db/

COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R appuser:appuser /app

USER appuser

EXPOSE 8083

ENTRYPOINT ["/entrypoint.sh"]
CMD [".venv/bin/uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8083"]
