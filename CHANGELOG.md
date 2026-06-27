# Changelog

All notable changes to this project are documented here.

## [0.5.4](https://github.com/pokjay/CookieJar/compare/v0.5.3...v0.5.4) (2026-06-27)


### Bug Fixes

* **frontend:** stop clipping income/expense bar labels ([#92](https://github.com/pokjay/CookieJar/issues/92)) ([#93](https://github.com/pokjay/CookieJar/issues/93)) ([b85ac7c](https://github.com/pokjay/CookieJar/commit/b85ac7c49ba71a249e5f2336e089e0bf57fdc6ca))

## [0.5.3](https://github.com/pokjay/CookieJar/compare/v0.5.2...v0.5.3) (2026-06-26)


### Bug Fixes

* **overview:** correct ~50% inflation in Net Worth by Category Over Time ([#86](https://github.com/pokjay/CookieJar/issues/86)) ([8eedbba](https://github.com/pokjay/CookieJar/commit/8eedbba723f80d9535f01a7ff73174e491e8f699))

## [0.5.2](https://github.com/pokjay/CookieJar/compare/v0.5.1...v0.5.2) (2026-06-19)


### Bug Fixes

* **investments:** sanitize NaN pandas values in nullable string fields ([#82](https://github.com/pokjay/CookieJar/issues/82)) ([0ed2090](https://github.com/pokjay/CookieJar/commit/0ed20902dfdd2d2489cd58e429360c335cfeab3e))

## [0.5.1](https://github.com/pokjay/CookieJar/compare/v0.5.0...v0.5.1) (2026-06-11)


### Bug Fixes

* code-review fixes — cash-flow consolidation, cache busting, auth hardening, router tests ([#59](https://github.com/pokjay/CookieJar/issues/59)) ([0522a51](https://github.com/pokjay/CookieJar/commit/0522a51fe0e5fd04c9825acd45c81323186cd7f7))

## [0.5.0](https://github.com/pokjay/CookieJar/compare/v0.4.1...v0.5.0) (2026-06-05)


### Features

* add show_in_transactions toggle to manual entry + CSV import ([#53](https://github.com/pokjay/CookieJar/issues/53)) ([6204238](https://github.com/pokjay/CookieJar/commit/62042380ec8e411b73a03d984b317018491c9c5f)), closes [#48](https://github.com/pokjay/CookieJar/issues/48)
* **manual-transactions:** support XLS/XLSX import ([#54](https://github.com/pokjay/CookieJar/issues/54)) ([ecfe537](https://github.com/pokjay/CookieJar/commit/ecfe53797d433fc81374f5cf6b5addcb8a981042)), closes [#44](https://github.com/pokjay/CookieJar/issues/44)


### Bug Fixes

* remove stale st.cache_data.clear() calls in create_mapping ([#52](https://github.com/pokjay/CookieJar/issues/52)) ([2ad6f5e](https://github.com/pokjay/CookieJar/commit/2ad6f5e63f28e15cd319f9c3ebe13b811242e41f)), closes [#47](https://github.com/pokjay/CookieJar/issues/47)

## [0.4.1](https://github.com/pokjay/CookieJar/compare/v0.4.0...v0.4.1) (2026-06-04)


### Bug Fixes

* **manual-transactions:** show real dropdown for account fixed value ([#46](https://github.com/pokjay/CookieJar/issues/46)) ([1a9dc65](https://github.com/pokjay/CookieJar/commit/1a9dc657990573bbc0e80946b7a8c5825da2be27)), closes [#45](https://github.com/pokjay/CookieJar/issues/45)
* **overview:** forward-fill per-account balances for net-worth charts ([#51](https://github.com/pokjay/CookieJar/issues/51)) ([8884347](https://github.com/pokjay/CookieJar/commit/88843470119a4f92fb57c31b6034de150dccad84))

## [0.4.0](https://github.com/pokjay/CookieJar/compare/v0.3.0...v0.4.0) (2026-05-24)


### Features

* **manual-transactions:** editable per-row CSV import preview ([#42](https://github.com/pokjay/CookieJar/issues/42)) ([944a622](https://github.com/pokjay/CookieJar/commit/944a62256438622ac1be773eb26ec8c6a5b3177c)), closes [#41](https://github.com/pokjay/CookieJar/issues/41)

## [0.3.0](https://github.com/pokjay/CookieJar/compare/v0.2.7...v0.3.0) (2026-05-23)


### Features

* **manual-transactions:** support fixed value per field in CSV import mapper ([#39](https://github.com/pokjay/CookieJar/issues/39)) ([a0813cf](https://github.com/pokjay/CookieJar/commit/a0813cfe18d41157aa8794fd02286bb8ac5246a6))

## [0.2.7](https://github.com/pokjay/CookieJar/compare/v0.2.6...v0.2.7) (2026-05-22)


### Bug Fixes

* use CAST() instead of ::jsonb in upsert_settings ([#36](https://github.com/pokjay/CookieJar/issues/36)) ([bb2d07d](https://github.com/pokjay/CookieJar/commit/bb2d07dee268e7e699a04c9b37c1963c701694c8))

## [0.2.6](https://github.com/pokjay/CookieJar/compare/v0.2.5...v0.2.6) (2026-05-22)


### Bug Fixes

* store dbmate schema_migrations in the moneyman schema ([#34](https://github.com/pokjay/CookieJar/issues/34)) ([b73bd7d](https://github.com/pokjay/CookieJar/commit/b73bd7d5a10c7de7db5c1b0c546114811fc00e2c))

## [0.2.5](https://github.com/pokjay/CookieJar/compare/v0.2.4...v0.2.5) (2026-05-22)


### Bug Fixes

* make run_migrations.py robust for existing-DB and SSL-less setups ([#32](https://github.com/pokjay/CookieJar/issues/32)) ([5f1a07d](https://github.com/pokjay/CookieJar/commit/5f1a07d2171aba604e04088b839c6670ad867fdd))

## [0.2.4](https://github.com/pokjay/CookieJar/compare/v0.2.3...v0.2.4) (2026-05-22)


### Bug Fixes

* persist settings in PostgreSQL to fix permission error ([#30](https://github.com/pokjay/CookieJar/issues/30)) ([de47ecc](https://github.com/pokjay/CookieJar/commit/de47ecc5d59434fc5af40a60b411d3157a4d76b5)), closes [#29](https://github.com/pokjay/CookieJar/issues/29)

## [0.2.3](https://github.com/pokjay/CookieJar/compare/v0.2.2...v0.2.3) (2026-05-21)


### Bug Fixes

* **ci:** build Docker images in release-please run so semver tags publish ([#27](https://github.com/pokjay/CookieJar/issues/27)) ([6d65e51](https://github.com/pokjay/CookieJar/commit/6d65e51cddafedc33068dbb4854a6d6e09c33145))

## [0.2.2](https://github.com/pokjay/CookieJar/compare/v0.2.1...v0.2.2) (2026-05-20)


### Bug Fixes

* **ci:** trigger Docker publish on release instead of tag push ([#21](https://github.com/pokjay/CookieJar/issues/21)) ([3122b80](https://github.com/pokjay/CookieJar/commit/3122b80ad752e1187c516f586b4a76f1e0fe16f2))

## [0.2.1](https://github.com/pokjay/CookieJar/compare/v0.2.0...v0.2.1) (2026-05-20)


### Bug Fixes

* **pwa:** add apple-touch-icon so iOS home screen shows CookieJar logo ([#18](https://github.com/pokjay/CookieJar/issues/18)) ([3bff4aa](https://github.com/pokjay/CookieJar/commit/3bff4aaca4d4d507b2066d80c8d3433aa8c3b74d))

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
