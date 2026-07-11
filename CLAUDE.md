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

## What not to do

- Never post PII to Github (IP Addresses, names, account details, etc...)
- **Never handle the user's real credentials.** Diagnose credential problems with *derived* properties — a value's length, a form's validity flag, whether a field was accepted — never the value itself. The scraper's KeePass vault is unlocked per-sync with a password only the user has; keep it that way. Printing a password "just to see what's wrong" leaks a live banking credential into container logs and the transcript.
- **Never log query strings, headers, or request bodies from bank sites.** That is where tokens and credentials live. Log origin + path only (see `traceUrl` in `scraper/src/app.js`).
- **Never run destructive Docker commands against the running stack** — no `down -v`, no `volume prune`, no deleting `config/`. The KeePass vault and the Postgres data live there. Experiment in throwaway `docker run --rm` containers instead, so the user's live stack is never disturbed.
- **Never install Node or Python packages onto the host.** No `npm install`, `npm ci`, `pip install`. The host has no `node_modules` and is not supposed to. See "Everything runs in Docker" below.

## Everything runs in Docker

JavaScript — frontend and scraper — only ever runs inside a container. There is no `node_modules` on the host, so anything that needs one (tests, lint, builds, a one-off script) runs in the image:

```bash
# scraper test suite — mount the sources over the image's copies
docker run --rm -v "$PWD/scraper/src:/app/src:ro" -v "$PWD/scraper/test:/app/test:ro" \
  -v "$PWD/scraper/providers.json:/app/providers.json:ro" \
  ghcr.io/pokjay/cookiejar-scraper:latest npm test

# build an image from local source instead of pulling it
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build <service>
```

Prefer the `make` targets (`make dev`, `make e2e`, …) wherever one exists.

**Python is the exception**: `uv` is the sanctioned host-side tool — it manages its own isolated environment, so it never pollutes the host. Run `uv run pytest` and `uv run ruff` directly, as in the Commands section above. Just don't reach for `pip`.

## Debugging the scraper

The scraper's normal failure mode is *a bank site changed under it*, which no unit test can catch — #109, #114 and #115 were all live-site behaviour the suite was blind to.

- **Verify scraper changes against the live provider before opening the PR.** A green suite proves nothing about a site that moved.
- **Use bogus credentials as the test harness.** A WAF block and a credential rejection look completely different — an HTML block page versus the bank's own JSON API answering — so almost everything can be verified against the real site with fake credentials and zero secrets.
- **Do not declare a hypothesis "ruled out" without testing it against the live system.** Reading the library source feels like proof and isn't: #114 was "ruled out" from a correct reading of `maskHeadlessUserAgent` whose conclusion was backwards, and one 3-minute live probe settled what a day of reasoning had gotten wrong.
- The scrape timeline is logged by default (`[trace]` / `[form]` lines) — read `docker compose logs scraper` before reaching for new instrumentation.

## Commit Conventions

- In branches: use conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, etc.)
- For PR merge: single squash commit based on the task description keeping the `feat:`, `fix:`, `chore:`, `refactor:`, etc. (e.g. `fix(server): queue version check job when config changed (#27094)`)
