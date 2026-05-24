# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

CookieJar is a family finance dashboard: **Next.js 15 frontend** → **FastAPI backend** → **PostgreSQL** (via [moneyman](https://github.com/daniel-hauser/moneyman) or manual import).

### Key structural points

- `src/` — shared Python logic (DB connection, queries, mutations, calculations, settings). Imported by both `backend/` and `tests/`.
- `backend/` — FastAPI app. Routers in `backend/routers/` call `backend/data.py` / `backend/data_transactions.py`, which call `src/db/queries/` and `src/db/mutations/`.
- `frontend/src/lib/api.ts` — all API calls from the frontend. Next.js rewrites `/api/*` to the FastAPI backend, so no CORS issues in development.
- `frontend/src/lib/types.ts` — TypeScript types shared across all frontend components.

### Data flow

All backend responses are cached for 5 minutes using `@ttl_cached` decorator (`backend/cache.py`). Call `cache.clear_all()` (via `POST /api/settings`) to invalidate after writes.

### Mock mode

`USE_MOCK_DATA=true` (default) bypasses the database entirely. `src/db/connection.py:is_mock_mode()` gates every query — each data function checks this and returns in-memory generated data from `src/db/mock_data.py` instead of running SQL.

### Authentication

The frontend uses next-auth (password-based, shared family password). The backend uses `API_SECRET` middleware (`backend/main.py`) that checks the `X-API-Secret` header on all routes except `/health`.

---

## Commands

### Development

```bash
make dev       # hot-reload (no local DB — uses mock data)
make dev-db    # hot-reload + local seeded PostgreSQL
make dev-down  # stop
```

### Backend (Python)

```bash
uv run pytest                          # run all unit tests
uv run pytest tests/test_calculations.py  # run a single test file
uv run pytest -m integration          # integration tests (requires TEST_DATABASE_URL)
uv run ruff check .                   # lint
uv run ruff format .                  # format
```

Before writing new tests (especially anything that hits the DB or drives the UI), read [docs/TESTING.md](docs/TESTING.md) — it covers the integration-test fixture pattern, the e2e parallel-DB-race pitfall, and how to debug CI-only failures.

### Frontend

```bash
cd frontend && npm run lint    # ESLint
cd frontend && npm run build   # production build (catches type errors)
```

### Database migrations (requires `brew install dbmate`)

```bash
dbmate up              # apply pending migrations
dbmate down            # roll back last migration
dbmate new <name>      # create a new migration file
dbmate dump            # regenerate db/schema.sql
```

Migrations live in `db/migrations/`. `db/schema.sql` is the auto-generated schema reference — commit it after any `dbmate dump`.

### E2E tests (Docker, no local install needed)

```bash
make e2e          # full cycle: build → start → test → teardown
make e2e-up       # start app only (useful for debugging tests)
make e2e-run      # run Playwright against an already-running stack
make e2e-down     # stop (preserves node_modules cache volume)
make e2e-clean    # full teardown including volumes
```

E2E specs that touch shared DB state must use `test.describe.configure({ mode: "serial" })` — see [docs/TESTING.md](docs/TESTING.md) for the why and other e2e gotchas.

---

# Claude Code Instructions

## Workflow

Tasks are tracked as GitHub Issues. Follow this procedure:

1. **Get task**: Issue number is provided
2. **Analyze**: Read the issue, understand requirements, ask clarifying questions if needed
3. **Branch**: Create a new branch with prefix matching the task type: `feat/`, `bug/`, `chore/`, `refactor/`, etc. followed by issue number and short description (e.g. `feat/42-add-export`)
4. **Implement**: Do the work, including adding relevant tests
5. **Test**: Run tests before opening the PR to make sure everything passes
6. **Visual check**: If the task involves a UI element, request a visual test from the user before proceeding
7. **PR**: Create a PR linked to the issue. Include `Closes #N` in the PR body to auto-close the issue on merge. For larger tasks, open as draft first if useful.
8. **Review**: Address any PR review comments
9. **Merge**: Squash-merge by default, with PR # in the commit title. Preserve granular commit history only when it adds meaningful value.
10. **Update issue**: Add a final summary to the issue.

## Commit Conventions

- In branches: use conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, etc.)
- For PR merge: single squash commit based on the task description keeping the `feat:`, `fix:`, `chore:`, `refactor:`, etc. (e.g. `fix(server): queue version check job when config changed (#27094)`)
