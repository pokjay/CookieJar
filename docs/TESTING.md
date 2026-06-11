# Testing

Three layers of tests, each with a different scope and runtime cost.

| Layer | Location | Runner | Touches DB? |
|---|---|---|---|
| Unit / data-function | `tests/test_*.py` (no `integration` mark) | `uv run pytest` | No — pure pandas / Python |
| Integration | `tests/test_*.py` marked `@pytest.mark.integration` (or `pytestmark = pytest.mark.integration`) | `uv run pytest -m integration` | Yes — needs `TEST_DATABASE_URL` |
| End-to-end | `e2e/*.spec.ts` | `make e2e` (Docker) | Yes — seeded compose DB |

## Running locally

```bash
# Unit tests only
uv run pytest

# Integration tests (point at a throwaway local Postgres)
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/family_finance_test \
    uv run pytest -m integration

# Full e2e via Docker (matches CI exactly)
make e2e
```

The `migrated_db` fixture in `tests/conftest.py` drops and recreates the `moneyman` schema for each session — your test DB is wiped clean each run. **Note:** the fixture currently only applies the initial migration; if a test depends on objects from a later migration (e.g. `app_settings`), you need to apply it manually or extend the fixture.

## E2E tests share database state — keep them serial inside a file

This is the most common way to introduce a flaky e2e test.

Each test file runs against the same `moneyman.transactions_manual` (and related) tables. Cleanup hooks (`beforeEach` / `afterEach`) usually wipe rows by some prefix or test-specific column. Under Playwright's default `fullyParallel: true`, multiple tests run in different workers at the same time — and **one test's `beforeEach` cleanup can delete rows another test just inserted but hasn't verified yet.**

Symptom: locally green at `--workers=1`, fails intermittently in CI (which runs at the runner's CPU count). You'll typically see an assertion like `expected 3 rows, received 1` with a subset of rows present in an order that suggests they were deleted mid-flight.

To reproduce locally, run with multiple workers and the `--repeat-each` flag:

```bash
cd e2e
npx playwright test <spec> --workers=4 --repeat-each=5
```

**Fix:** add this at the top of any spec file whose tests touch shared DB state:

```ts
// Tests in this file mutate the same DB rows and share cleanup hooks.
// Serial mode prevents cross-test races. Other spec files keep parallelism.
test.describe.configure({ mode: "serial" });
```

If you genuinely want parallelism inside the file, namespace the data per test (e.g. use `testInfo.workerIndex` in the account name) so cleanups don't collide.

## Other e2e gotchas

- **Async data races.** Components that fetch data in `useEffect` (e.g. `getSettingsAccounts` in the CSV import flow) need an explicit `page.waitForResponse(...)` before the test asserts on the rendered values — otherwise the test sometimes runs before the API returns. For dropdowns/lists whose options depend on the fetch, use `expect.poll(() => locator.count()).toBeGreaterThan(0)` so a late response still satisfies the assertion.
- **DB-level assertions** — `e2e/manual-transactions-import.spec.ts` queries `moneyman.transactions_manual` directly via the `pg` library to verify imports landed. The playwright Docker service has `PG*` env vars wired up in `docker-compose.test.yml`; for local dev set them to your local Postgres.
- **Stable locators.** Prefer `data-testid` attributes over CSS-class or column-index chains. The preview-table cells use `data-testid="preview-row-<i>"` / `preview-cell-<col>"`; reach inputs via `getByTestId(...).locator("input, select").first()`.
- **Expected values come from a generated fixture.** Specs that assert on mock-data aggregates (e.g. `overview.spec.ts`) import `e2e/fixtures/expected-overview.json` instead of hardcoding totals. After changing `src/db/mock_data.py`, regenerate it with `USE_MOCK_DATA=true uv run python scripts/generate_e2e_fixtures.py` and commit the diff.

## Debugging CI e2e failures

The workflow uses `reporter: "github"`, which writes annotations but no HTML report — the "No files were found at e2e/playwright-report/" warning on every run is expected. To see the failing assertion you have to read the workflow logs in the GitHub Actions UI (the unauthenticated REST API will rate-limit you).

When a CI failure isn't obviously a flake, **reproduce it locally with `--workers=4`** before guessing — the most common CI-only failure mode is exactly the parallelism race described above.

## Backend integration test fixture pattern

For tests that hit a FastAPI route handler against a real DB, use the pattern in `tests/test_manual_transactions_bulk.py`:

```python
@pytest.fixture
def bulk_endpoint(migrated_db, monkeypatch):
    # render_as_string(hide_password=False) — str(engine.url) masks the password
    url = migrated_db.url.render_as_string(hide_password=False)
    if "options=" not in url:
        url = f"{url}?options=-csearch_path%3Dmoneyman"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("USE_MOCK_DATA", "false")
    # Reset the cached engine; monkeypatch restores it on teardown
    import src.db.connection as conn_mod
    monkeypatch.setattr(conn_mod, "_engine", None)
    from backend.routers.manual_transactions import BulkImportPayload, bulk_import
    return lambda rows: bulk_import(BulkImportPayload(rows=rows))
```

Calling the handler directly (instead of via `TestClient`) avoids pulling in `httpx` just for tests.
