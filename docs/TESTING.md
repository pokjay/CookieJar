# Testing

Four layers of tests, each with a different scope and runtime cost.

| Layer | Location | Runner | Touches DB? |
|---|---|---|---|
| Unit / data-function | `tests/test_*.py` (no `integration` mark) | `uv run pytest` | No — pure pandas / Python |
| Scraper sidecar unit | `scraper/test/*.test.js` | `cd scraper && npm test` (`node:test`, no extra deps) | No |
| Integration | `tests/test_*.py` marked `@pytest.mark.integration` (or `pytestmark = pytest.mark.integration`) | `uv run pytest -m integration` | Yes — needs `TEST_DATABASE_URL` |
| End-to-end | `e2e/*.spec.ts` | `make e2e` (Docker) | Yes — seeded compose DB |

The backend unit layer and the scraper layer run on every PR via
`.github/workflows/tests.yml` (which also gates `ruff check`).

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

## Unit tests can never reach a real database

`tests/conftest.py` hard-forces `USE_MOCK_DATA=true` and blanks `DATABASE_URL` *before any test module is imported*, and an autouse `_enforce_mock_mode` fixture fails any non-`integration` test that isn't in mock mode. This matters because `src.db.connection` calls `load_dotenv()` at import time: without the guard, a `.env` with `USE_MOCK_DATA=false` + a real `DATABASE_URL` would leak into the unit suite (the per-file `os.environ.setdefault(...)` lines are no-ops once that's happened), and an unmarked router **write** test could read or write production data. Integration tests opt back in explicitly with `monkeypatch.setenv("USE_MOCK_DATA", "false")` + `setenv("DATABASE_URL", <test url>)` (see `test_manual_transactions_bulk.py`).

## Scraper sidecar tests (`scraper/test/`)

The sidecar suite uses Node's built-in `node:test` runner — deliberately zero
dev dependencies, since this container handles bank credentials and a minimal
supply-chain surface is a feature. `scraper/src/app.js` exposes
`createApp({ scraperFactory, token })`; tests inject a stub factory instead of
module-mocking `israeli-bank-scrapers`, boot the app on an ephemeral port, and
drive it with the built-in `fetch`.

Two gotchas:

- **Provider drift guard.** `scraper/providers.json` is the shared manifest of
  supported providers and their credential fields. `scraper/test/providers.test.js`
  checks it against the library's `CompanyTypes`/`SCRAPERS.loginFields`, and
  `tests/test_scraper_keepass.py` checks it against `PROVIDER_SCHEMAS`. Adding
  or changing a provider means updating all three, and a library bump that
  changes login fields fails CI instead of the next real sync. The same applies
  to the error-type mapping: `LIBRARY_ERROR_TYPE_MAP` in `app.js` is pinned
  against the library's real `ScraperErrorTypes` enum.
- **The `preparePage` browser test** (`preparepage.browser.test.js`) launches a
  real Chromium to assert the WAF-hardening: the #109 masking (masked
  `navigator.webdriver`, non-headless UA, `he-IL` accept-language on the wire)
  and the #114 consistency rule (the UA keeps the real platform — every OS
  signal the browser emits must name the same OS; the old Windows UA spoof is
  now a failure). It needs
  `PUPPETEER_EXECUTABLE_PATH` pointing at a browser binary and **skips** when
  none is found — except when `REQUIRE_BROWSER_TESTS` is set (CI sets it), where
  a missing browser fails the run so the hardening guard can't silently stop
  running.

Nothing in this suite touches real bank sites; per-provider egress/anti-bot
probes are the separate `doctor` tool below.

## Scraper access-level probe (`npm run doctor`)

`scraper/src/doctor.js` diagnoses **where** a provider is broken by running
escalating levels of access, so a failure pins to a layer instead of
collapsing to `generic-error`:

| Level | Checks | Network | Browser |
|---|---|---|---|
| L0 config | provider known to `israeli-bank-scrapers`, fields match the manifest | no | no |
| L1 egress | TLS-connect each host the provider's scraper uses | yes | no |
| L2 anti-bot | hardened browser reaches the real login page, not a WAF block | yes | yes |
| L3 wrong-creds | bogus credentials classify as `wrong-credentials`, not a timeout | yes | yes |
| L4 full scrape | real credentials return transactions | yes | yes |

```bash
cd scraper
npm run doctor                              # all providers, up to L2
npm run doctor -- --provider visaCal --level 3
npm run doctor -- --json                    # machine-readable matrix
```

**Run it on the deploy host / inside the sidecar container** — that's where
L1/L2 results are meaningful. In GitHub Actions the probe is an early-warning
trend signal only (`.github/workflows/scraper-probes.yml`, weekly +
`workflow_dispatch`), **never a required check**: runner IPs differ from the
deploy host and bank WAFs geo/datacenter-filter, so a red L2 from CI can be
pure runner-IP reputation. The scheduled run caps at L2; L3 (which submits
bogus credentials to real endpoints) is manual-dispatch only.

L2/L3 depend on `probes.json` (login URLs, selectors, egress hosts derived from
the library's scraper sources) — revisit it when the pinned
`israeli-bank-scrapers` version changes. The doctor's pure logic (arg parsing,
config check, level roll-up, exit code, matrix) is unit-tested in
`test/doctor.test.js`; the live network checks are exercised only by the
scheduled workflow.

**L4 is manual and needs real credentials + live 2FA/OTP** — never in CI. On
the deploy host, pass each provider's login fields as a JSON env var:

```bash
PROBE_CREDS_visaCal='{"username":"...","password":"..."}' \
    npm run doctor -- --level 4 --provider visaCal
```

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
