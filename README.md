<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/public/brand/lockup-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="frontend/public/brand/lockup-light.svg">
    <img alt="CookieJar" src="frontend/public/brand/lockup-dark.svg" height="56">
  </picture>
</p>

<p align="center">Family finance dashboard — spending, investments, cash flow, and net worth in one place.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js&logoColor=white" alt="Next.js 15">
  &nbsp;
  <img src="https://img.shields.io/badge/FastAPI-0.11x-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  &nbsp;
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" alt="Python 3.12">
  &nbsp;
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL">
  &nbsp;
  <img src="https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white" alt="Docker">
  &nbsp;
  <img src="https://img.shields.io/badge/E2E-Playwright-45ba4b?logo=playwright&logoColor=white" alt="E2E Playwright">
  &nbsp;
  <a href="COPYING"><img src="https://img.shields.io/badge/license-GPLv3-blue" alt="GPL v3 License"></a>
</p>

---

> [!WARNING]
> **Built for personal, self-hosted use only.** Automated access to financial institutions may violate their Terms of Service — run this on your own machine, against your own accounts, and do not expose it as a public or shared service.
>
> This software is provided as-is, without any warranty. You use it entirely at your own risk. The authors accept no liability for financial data loss, inaccuracies, or any damages arising from its use.

---

![CookieJar screenshot](docs/screenshot.png)

---

## Why CookieJar

Most personal finance tools are cloud-based, subscription-gated, and built for a single person. CookieJar is none of those things.

- **Family-first** — net worth, cash flow, and spending are tracked per family member, with household rollups alongside individual views
- **Flexible data ingestion** — works great with [moneyman](https://github.com/daniel-hauser/moneyman) for automatic Israeli bank and credit card imports, or ingest data any other way (CSV imports, manual entry) — CookieJar just reads from PostgreSQL
- **Self-hosted, no cloud** — your financial data never leaves your machine
- **No subscription** — runs on a single `make up`

---

## Features

- **Overview** — total and per-person net worth with year-over-year delta, asset allocation, and average monthly income vs. expenses
- **Cash Flow** — monthly income, expenses, and savings broken down per person and as a household
- **Investments** — investment account balances and performance tracking
- **Transactions** — spending by category, year-over-year trends, and subscription detection
- **Travel** — travel expenses broken down by subcategory and trip
- **Category & Business Mapping** — classify uncategorized transaction descriptions and map generic entries to specific business names
- **Manual Transactions** — add income or expense entries not captured automatically
- **Light & dark theme** — full theme support with a custom CookieJar palette

---

## Quick start

No database required — the app ships with seeded sample data so you can run it immediately.

**1. Copy and edit the env file**

```bash
cp .env.example .env
```

Set these three values:

| Variable | Description |
|---|---|
| `NEXTAUTH_SECRET` | Random secret — `openssl rand -base64 32` |
| `AUTH_PASSWORD` | Shared family login password |
| `NEXTAUTH_URL` | Browser-facing URL of the app (e.g. `http://localhost:3001`) |

**2. Enable sample data**

In `.env`, make sure these are set (they are the defaults in `.env.example`):

```bash
USE_MOCK_DATA=true
COMPOSE_FILE=docker-compose.yml:docker-compose.db.yml
```

**3. Start**

```bash
make up   # → http://localhost:3001
```

That's it. The stack spins up a local PostgreSQL, seeds it with sample data, and starts the app.

> To stop: `make down`. To tail logs: `make logs`.

### Connecting a real database

When you have real transaction data from [moneyman](https://github.com/daniel-hauser/moneyman), switch to real DB mode:

```bash
# .env
USE_MOCK_DATA=false
# COMPOSE_FILE=...   ← comment this out
DATABASE_URL=postgresql://user:pass@host:5432/dbname?options=-csearch_path%3Dmoneyman
```

> The backend caches all data for 5 minutes. Restart to see database changes immediately.

---

## Data source

CookieJar reads from a PostgreSQL `transactions` table and doesn't care how data gets there. The recommended path is [moneyman](https://github.com/daniel-hauser/moneyman), which automatically scrapes Israeli bank and credit card accounts and writes into that table. Alternatively, import CSVs or add entries manually through the app.

---

## Development

Hot-reload — source changes reflected without rebuilding images:

```bash
make dev       # hot-reload, no local DB
make dev-db    # hot-reload + local seeded database
make dev-down  # stop
```

**Schema migrations** — requires [`dbmate`](https://github.com/amacneil/dbmate) (`brew install dbmate`):

```bash
dbmate up           # apply pending migrations
dbmate down         # roll back last migration
dbmate new <name>   # create a new migration file
dbmate dump         # regenerate db/schema.sql from live DB
```

Migrations live in `db/migrations/`. `db/schema.sql` is the auto-generated single-file schema reference.

---

## Testing

Playwright E2E tests run against the full app stack in Docker — no local installs needed:

```bash
make e2e        # build → start → test → teardown (always a clean DB)
make e2e-up     # start app only (useful for debugging)
make e2e-run    # run tests against an already-running stack
make e2e-down   # stop (preserves node_modules cache volume)
make e2e-clean  # full teardown including volumes
```

CI runs on every push and pull request via `.github/workflows/e2e.yml`.

---

## Project structure

```
frontend/          Next.js app (Tremor + Recharts + next-auth)
backend/           FastAPI backend (data layer + REST endpoints)
e2e/               Playwright tests
db/
  migrations/      Schema migrations (dbmate)
  schema.sql       Auto-generated schema reference
scripts/           Seed and utility scripts
config/            Persisted app settings (gitignored)
```

---

## App configuration

From the home page settings panel you can configure:

- **Family members** — assign persons to Parent 1, Parent 2, and Kids roles (used to split dashboards per person)
- **Sign-flipped accounts** — accounts where debit amounts are stored as negative numbers
- **Cash flow bank accounts** — bank accounts whose manual transactions derive cash flow data
- **Account-to-person mapping** — assigns each account to a family member for attribution

Settings are saved to `config/app_settings.json` and restored on each visit.
