# Test plan: scraper sidecar tests + per-provider access-level checks (#110)

Status: **proposed** — this challenges and revises the scope of issue #110 before implementation.

## TL;DR of scope changes vs. the issue

| Issue asked for | This plan says |
|---|---|
| L0–L2 run in CI, L3 "CI-able if stable" | L0 in merge-blocking CI. L1–L2 become a **`doctor` diagnostic script** run on a weekly schedule + manual dispatch, never merge-blocking. L3 (submitting bogus creds to real banks) is **manual-only**. |
| Part 2: unit tests for current sidecar behavior | Yes — plus **fix a latent bug first**: `SAFE_ERROR_TYPES` can never match the library's actual `errorType` values, so *every* non-throwing failure already collapses to `generic-error`. Testing the current behavior would enshrine the exact symptom the issue complains about. |
| Part 3: `run_sync` + router + concurrency tests | ~70% **already exists** (`tests/test_scraper*.py`). Only the `run_sync` roll-up/error-path gaps remain. |
| "Dependency freshness signal" check | **Dropped** as a test. `.github/dependabot.yml` already exists but doesn't cover `/scraper` — add a one-stanza npm entry there instead. |
| (not requested) | **New CI workflow required**: no workflow runs `pytest` or any JS tests today — only e2e, schema-check, docker-publish and release-please exist. "Should run in CI" first needs a unit-test CI job at all. |

## Findings from the codebase that shape the plan

### F1 — The sidecar is structurally untestable today

`scraper/src/index.js` calls `app.listen()` at module top level and exports nothing, and `createScraper` is imported directly so the `/scrape` route can't be exercised without a real browser. Prerequisite refactor (no behavior change):

- `scraper/src/app.js` — `export function createApp({ scraperFactory = createScraper } = {})`, plus `export { classifyError, preparePage, SAFE_ERROR_TYPES }`.
- `scraper/src/index.js` — thin entry: `createApp().listen(PORT)`. Dockerfile `CMD` unchanged.

The injectable `scraperFactory` lets unit tests stub scrape results without module-mocking (node's `mock.module` is still experimental).

### F2 — Latent bug: the safe-error pass-through never passes anything through

`israeli-bank-scrapers@6.8.0` returns `result.errorType` from its `ScraperErrorTypes` enum: `INVALID_PASSWORD`, `CHANGE_PASSWORD`, `TIMEOUT`, `ACCOUNT_BLOCKED`, `GENERIC`, `GENERAL_ERROR`, `TWO_FACTOR_RETRIEVER_MISSING` (verified against the installed package). The sidecar's `SAFE_ERROR_TYPES` is `{wrong-credentials, timeout, account-blocked, generic-error}` — the two vocabularies are disjoint, so `SAFE_ERROR_TYPES.has(result.errorType)` is always false and the `!result.success` path (the *normal* failure path — the library returns error results rather than throwing) always reports `generic-error`. Wrong credentials are never classified as `wrong-credentials` unless the library happens to *throw* with "password" in the message.

This is precisely the "every failure collapsed to a `generic-error` that told us nothing" motivation of #110, and it makes the issue's L3 goal ("wrong-credentials classified promptly") unachievable without a code fix. **Scope addition:** add an explicit mapping in the sidecar —

```
INVALID_PASSWORD | CHANGE_PASSWORD → wrong-credentials
TIMEOUT                            → timeout
ACCOUNT_BLOCKED                    → account-blocked
everything else                    → generic-error   (never pass raw values through)
```

— and pin it with a unit test that imports the real `ScraperErrorTypes` from the library, so a library bump that renames enum values fails the test (same spirit as the schema drift guard).

### F3 — A strong L0 drift guard is possible

The library exports `SCRAPERS` metadata: `SCRAPERS[companyId].loginFields` is exactly `["id","card6Digits","password"]` for isracard/amex and `["username","password"]` for visaCal/max — identical to `PROVIDER_SCHEMAS` in `backend/scraper_keepass.py`. So L0 can assert **field-list equality**, not just "companyId is recognized". To bind the Python and JS sides without cross-language imports:

- New `scraper/providers.json` — single source of truth: `{"isracard": ["id","card6Digits","password"], ...}`.
- JS test: every entry's key exists in `CompanyTypes` and its fields equal `SCRAPERS[key].loginFields`. Catches library bumps that add/rename login fields (the 4.5→6.8 class of breakage from #109).
- Python test: `PROVIDER_SCHEMAS == json.load("scraper/providers.json")`. Catches the two sides drifting.

### F4 — Part 3 is mostly done already

Already covered (don't re-implement): sync 409 pre-check + `RunAlreadyRunningError` race (`test_scraper.py`), stale-run cleanup at trigger time, mock-mode `/sync` → 503, wrong vault password → 401 + full rate-limiter matrix incl. X-Forwarded-For spoofing backstop (`test_scraper_router.py`), run-always-finished-on-unexpected-exception, per-tx account-number fallbacks, DB-level run/upsert semantics (`test_scraper_integration.py`).

Actual gaps in `run_sync` (`backend/scraper_sync.py`):
- status roll-up: all-success → `success`, mixed → `partial`, all-error → `error`, empty credential list → `error`
- `httpx.ConnectError` → account error `unavailable`; other request exception → `unknown`
- sidecar responds with `errorType` set → account error with that type, no upsert
- `upsert_transactions` raises → `db_error` and the loop continues to the next account
- cache cleared exactly once (finally) in success and failure runs

### F5 — There is no unit-test CI at all

`.github/workflows/` = e2e, schema-check, docker-publish×2, release-please. The ~40 existing backend tests never run in CI. Any "runs in CI" promise in #110 starts with a new workflow.

## Challenge: why L1–L3 must not be per-PR CI

1. **Wrong network.** GitHub-hosted runners egress from US datacenter IPs; Israeli bank WAFs geo-/datacenter-filter. A green L1/L2 in Actions says nothing about the user's deployment host (where #109 was actually debugged), and a red one may be pure runner-IP reputation. The diagnostic value of L1/L2 is *on the machine running the sidecar*.
2. **Flaky merge-blocking on third-party weather.** Bank-site incidents, WAF rule changes, and rate limits would block unrelated PRs.
3. **Bad-neighbor traffic.** Hitting bank login pages on every PR — and L3 *submitting bogus credentials* — invites IP blocks and violates the spirit of the banks' ToS. Repeated automated bogus logins are how you get the WAF rules tightened for everyone (including moneyman users).

**Reframe:** L1–L3 become `scraper/src/doctor.js` (`npm run doctor [-- --provider visaCal --level 2]`) — an operator diagnostic that prints the per-provider matrix and exits non-zero below the requested level. It runs (a) inside the deployed sidecar container, where results are meaningful, and (b) in a **scheduled weekly + `workflow_dispatch`** workflow as an early-warning trend signal — `continue-on-error` semantics, never a required check. L3 runs only with an explicit `--level 3` / dispatch input, never on schedule. The unit-level replacement for L3's regression value is F2's error-mapping tests.

**L4** stays out of CI entirely (real creds + OTP can't be automated safely): documented as `docker compose exec scraper npm run doctor -- --level 4 --provider X` with creds via env. The "matrix report" deliverable is the doctor's output table (also written to `$GITHUB_STEP_SUMMARY` in the scheduled run).

## Plan of record

### Phase 1 — sidecar testability + unit suite + merge-blocking CI

1. Refactor per F1 (`createApp` factory; no behavior change; Docker CMD unchanged).
2. Fix the error mapping per F2 (small, well-understood; the tests below pin it).
3. Test runner: **`node:test`** (built-in, Node ≥20). Zero new runtime or dev dependencies in a container that holds bank credentials in memory — keeping its supply-chain surface minimal is a feature. `npm test` → `node --test test/`. Route tests use `createApp(...).listen(0)` + built-in `fetch`; no supertest.
4. `scraper/test/` coverage:
   - `classifyError`: credential/password/login → `wrong-credentials`; timeout/timed out → `timeout`; block/captcha → `account-blocked`; other → `generic-error`; null/undefined → `unknown`; non-Error input.
   - Library `errorType` mapping (F2), driven by the real `ScraperErrorTypes` export (drift-pinned).
   - Error-leak safety: unknown/unsafe `errorType` → `generic-error`; error responses contain no `errorMessage`, page text, or credential values (assert the raw credential string never appears in any error response body).
   - Request validation: missing `account` / `companyId` / `credentials` → 400 `generic-error`; **invalid/missing `startDate` → 400** (in the code today, omitted from the issue); `createScraper` throwing → 400.
   - Success path (omitted from the issue): multi-account result flattens all `txns`, each tagged with its own `accountNumber`; top-level `accountNumber` is the first account's; `errorType: null`.
   - Auth middleware: token set + missing/wrong header → 401; correct Bearer token → 200; token unset → open (assert and document).
   - `/health` → `{status: "ok"}` without auth.
   - L0 drift guard per F3 (`providers.json` ↔ `CompanyTypes`/`SCRAPERS.loginFields`).
   - `preparePage` hardening (the #109 fix): launch real Chromium via the library's own puppeteer, run `preparePage`, load a `data:` page, assert `navigator.webdriver === undefined`, UA contains no `HeadlessChrome`/`Linux` and does contain the real Chrome version, `navigator.languages` starts with `he-IL`. Separate file (`test/preparepage.browser.test.js`) so the fast suite stays browser-free. *(Superseded by #114: the UA now deliberately keeps the real platform — `Linux` stays in the UA — and only the `HeadlessChrome` token is masked; the no-`Linux` assertion described here was the bug.)*
5. Python side of the drift guard: `tests/test_scraper_keepass.py::test_provider_schemas_match_shared_manifest`.
6. New `.github/workflows/tests.yml` (merge-blocking):
   - `backend`: `uv sync` → `uv run ruff check .` → `uv run pytest` (finally puts the existing ~40 tests in CI).
   - `scraper`: `npm ci` (in `scraper/`) → `npm test`, with `PUPPETEER_SKIP_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH` pointed at the runner's preinstalled Chrome for the browser test.

### Phase 2 — backend `run_sync` gap tests

Add to `tests/test_scraper.py` (mock `_scrape_account` + mutation functions, same style as the existing tests): the F4 gap list — roll-up matrix, `ConnectError → unavailable`, generic exception → `unknown`, sidecar `errorType` passthrough to `finish_run_account`, `db_error` continues the loop, cache-clear invariant.

### Phase 3 — doctor script + scheduled probe workflow (revised L1–L3)

1. `scraper/src/doctor.js` + `scraper/probes.json` (per provider: egress hosts, login URL, login-form selector, "blocked" marker text):
   - **L1 egress**: TLS connect to each host — e.g. visaCal: `www.` / `connect.` / `api.` / `digital-web.cal-online.co.il`; max: `www.max.co.il`, `onlinelcapi.max.co.il`; isracard: `digital.isracard.co.il`; amex: `he.americanexpress.co.il` (host lists extracted from the library's scraper sources; revalidate during implementation).
   - **L2 anti-bot**: hardened browser (same `preparePage` + launch args as production) navigates to the login URL; pass = login-form selector visible; fail = `Request Rejected` / block-page marker — the exact check that would have caught the #109 Cal WAF regression.
   - **L3 wrong-creds** (explicit opt-in only): dummy creds through `createScraper`, assert `wrong-credentials` within a deadline, not a timeout/`generic-error`.
   - Output: matrix table + `--json`; exit code = worst provider below `--level`.
2. `.github/workflows/scraper-probes.yml`: weekly cron + `workflow_dispatch` (inputs: provider, level ≤2 default, 3 allowed manually); runs doctor in the built scraper image; writes the matrix to the step summary. Not a required check; failures notify (issue-creation step optional, start without it).
3. L4: README/TESTING.md documented manual procedure only.

### Phase 4 — housekeeping

- `.github/dependabot.yml`: add `package-ecosystem: npm, directory: /scraper` (weekly, same patch-ignore policy). Replaces the issue's bespoke freshness check.
- `docs/TESTING.md`: add the scraper suite + doctor to the layer table; note the browser-test env vars.
- Issue #110 checklist comment mapping each original bullet → shipped test / revised location.

### Suggested PR slicing

1. PR 1 (Phases 1–2): refactor + error-mapping fix + full unit suites + `tests.yml` + dependabot stanza. This is the CI safety net and the direct #109 regression guard.
2. PR 2 (Phase 3): doctor + scheduled probes. Independent, network-facing, easier to review separately.

## Risks / open questions

- **Probe stability**: bank WAFs may block GH runner IPs outright, making scheduled L2 permanently red from Actions. Mitigation: it's non-blocking, and the doctor's primary home is the deployment host. If Actions proves useless, keep the doctor and drop the schedule.
- **Chromium in CI** for the `preparePage` test: relies on the runner's preinstalled Chrome; fallback is running that one test inside the scraper Docker image.
- **`CHANGE_PASSWORD` → `wrong-credentials`** conflates "password expired" with "password wrong" in the UI. Acceptable for now (both mean "go fix your credentials"); revisit if a distinct status is wanted — flagging so it's a decision, not an accident.
