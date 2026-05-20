# Changelog

All notable changes to this project are documented here.

## [0.2.0](https://github.com/pokjay/CookieJar/compare/v0.1.0...v0.2.0) (2026-05-20)


### Features

* add API secret middleware to protect backend from direct access ([#4](https://github.com/pokjay/CookieJar/issues/4)) ([7b3e179](https://github.com/pokjay/CookieJar/commit/7b3e179da14f94edd8b4c50854ebcd07e0c948fe))
* add automated Docker builds and release-please versioning ([#10](https://github.com/pokjay/CookieJar/issues/10)) ([a37ab9e](https://github.com/pokjay/CookieJar/commit/a37ab9eb0dc6f0f87760436b9b5c62e099155818))
* initial public release ([64c6f21](https://github.com/pokjay/CookieJar/commit/64c6f21e8c529ab82f77a7bd1e1e66f51bb2c259))


### Bug Fixes

* replace clipped SVG labels with responsive legend on mobile for pie chart ([#8](https://github.com/pokjay/CookieJar/issues/8)) ([194aa95](https://github.com/pokjay/CookieJar/commit/194aa95552af991b57a05c8abfec9759410cc505))
* switch vercel.json from deprecated routes to rewrites ([#3](https://github.com/pokjay/CookieJar/issues/3)) ([79f866b](https://github.com/pokjay/CookieJar/commit/79f866b8f29a78b8c63031c5b088fca643319f46))

## [Unreleased]

### Added
- **Schema as code** (PR #29, closes #11) — dbmate migration files in `db/migrations/`, `db/schema.sql` auto-generated as a single-file schema reference, `docker-compose.yml` for spinning up a local Postgres instance, `scripts/seed_dev_db.py` for seeding a dev DB with mock data, and pytest integration test fixtures
- **NiceGUI POC** (PR #26, closes #25) — proof-of-concept recreating the Overview page in NiceGUI (FastAPI + Vue/Quasar) to evaluate it as a Streamlit alternative; runs on port 8082 alongside the existing app
- **Next.js POC** (PR #28, closes #27) — proof-of-concept with a FastAPI backend and Next.js + Tremor + Recharts frontend recreating the Overview page; runs on port 8083

### Removed
- **Streamlit decommission** (PR #74, closes #39) — removed `pages/`, `app.py`, `.streamlit/`, and `src/components/` now that all pages have been ported to Next.js; stripped Streamlit deps from `pyproject.toml`; replaced `@st.cache_data` decorators in `src/db/queries/` (backend already wraps these with its own TTL cache) and `st.session_state` writes in `src/db/mutations/` mock paths

---

## 2026-03-21

### Added
- **Sankey diagram** (PR #22, closes #18) — interactive yearly cash flow Sankey chart on the Cash Flow page using Apache ECharts; shows Income → expense categories / savings → subcategories; subcategories expandable per category via pills selector; full-screen toggle
- **Yearly cash flow tables on Overview** (PR #21, closes #6) — household and per-person yearly cash flow aggregation tables added to the Overview page

### Fixed
- **Savings rate axis truncation** (PR #19, closes #10) — secondary y-axis on the "Income, Expense & Savings Rate" chart was hardcoded to `[0, 50]`; now derived dynamically from actual data with ±5 padding

---

## 2026-03-20

### Added
- **Cash flow from manual transactions** (PR #3) — automatically derive monthly cash flow from `transactions_manual` when data is absent from the `monthly_cash_flow` table; replaces `is_savings` boolean with a `cash_flow_type` enum (`salary`, `other_income`, `expense`, `savings`, `internal_transfer`); new Cash Flow bank account and account-to-person mapping settings; monthly transaction drilldown on Cash Flow page

---

## 2026-03-15 — Initial release

### Added
- **7-page dashboard** (PR #1) — Overview (net worth, investments), Cash Flow, Transactions, Travel, Category Mapping, Business Mapping, Manual Transactions
- Mock data mode (`USE_MOCK_DATA=true`) — full realistic sample dataset, no database required
- Settings persistence — family member configuration, sign-flipped accounts, account-to-person mapping saved to `config/app_settings.json`
- Manual transaction entry — single-form and CSV import with validation and duplicate detection
- Charts — net worth over time, YoY spend comparisons, category breakdowns, subscription detection, day-of-week heatmaps
- Data management — category mapping and business description mapping pages
