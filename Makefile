COMPOSE      := docker compose
COMPOSE_APP  := $(COMPOSE) -f docker-compose.yml
COMPOSE_DEV  := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_DEVDB := $(COMPOSE) -f docker-compose.yml -f docker-compose.db.yml -f docker-compose.dev.yml
# -p is load-bearing, not cosmetic. Every stack here otherwise shares the project
# name derived from the directory ("cookiejar"), and the e2e file set inherits the
# real app's volumes from docker-compose.yml — including keepass_data, which holds
# the user's KeePass vault of live bank credentials. The `e2e` and `e2e-clean`
# targets below run `down -v`, so under the shared name they DESTROY THE VAULT
# (and the dev database) as a side effect of running the tests. Giving the e2e
# stack its own project scopes its volumes to cookiejar-e2e_*, so `down -v` can
# only ever reach test state. Costs one DB re-seed the first time it runs.
COMPOSE_E2E  := $(COMPOSE) -p cookiejar-e2e -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.db.yml -f docker-compose.test.yml

SCRAPER_IMAGE := ghcr.io/pokjay/cookiejar-scraper:latest

.PHONY: up down logs dev dev-rebuild dev-db dev-down doctor e2e e2e-up e2e-run e2e-down e2e-clean \
        test test-py test-scraper

# ─── App ──────────────────────────────────────────────────────────────────────

up:
	$(COMPOSE_APP) up -d

down:
	$(COMPOSE_APP) down --remove-orphans

logs:
	$(COMPOSE_APP) logs -f

# ─── Dev (hot-reload) ─────────────────────────────────────────────────────────

## Start with hot-reload; source changes are reflected without rebuilding
dev:
	$(COMPOSE_DEV) up --build

## Start with hot-reload + local seeded database
dev-db:
	$(COMPOSE_DEVDB) up --build

## Rebuild after dependency changes (package.json / pyproject). Renews the
## anonymous node_modules volume, which a plain `make dev --build` reuses stale.
dev-rebuild:
	$(COMPOSE_DEV) up --build --renew-anon-volumes

## Stop dev services
dev-down:
	$(COMPOSE_DEV) down --remove-orphans

# ─── Tests ────────────────────────────────────────────────────────────────────

## Unit tests for both languages. Excludes e2e (see `make e2e`) and the
## integration tests, which need TEST_DATABASE_URL.
test: test-py test-scraper

## Python. uv is the sanctioned host-side tool — it manages its own isolated
## environment, so it never pollutes the host.
test-py:
	uv run pytest

## Scraper (JS). There is no node_modules on the host and there is not supposed
## to be, so this runs in the image with the local sources mounted over the
## image's copies — the suite tests working-tree code, not what was baked in.
test-scraper:
	docker run --rm \
		-v "$(CURDIR)/scraper/src:/app/src:ro" \
		-v "$(CURDIR)/scraper/test:/app/test:ro" \
		-v "$(CURDIR)/scraper/providers.json:/app/providers.json:ro" \
		-v "$(CURDIR)/scraper/probes.json:/app/probes.json:ro" \
		$(SCRAPER_IMAGE) npm test

# ─── Bank-sync diagnostics ────────────────────────────────────────────────────

## Probe each bank provider's access level (config → egress → anti-bot → ...)
## against the RUNNING scraper sidecar, so results reflect the deploy host's IP
## — where an anti-bot/WAF check is actually meaningful (unlike CI). Needs the
## stack up (`make up`). Pass args via ARGS, e.g.
##   make doctor ARGS="--provider visaCal --level 3"
doctor:
	$(COMPOSE_APP) exec scraper npm run doctor -- $(ARGS)

# ─── E2E ──────────────────────────────────────────────────────────────────────

## Start app services in the background without running tests (useful for local debugging)
e2e-up:
	$(COMPOSE_E2E) up -d --build backend frontend

## Run Playwright against an already-running stack (skips build/start)
e2e-run:
	$(COMPOSE_E2E) run --rm playwright

## Tear down the E2E stack, keep named volumes (node_modules cache survives)
e2e-down:
	$(COMPOSE_E2E) down --remove-orphans

## Full teardown including all named volumes (clean slate for next run)
e2e-clean:
	$(COMPOSE_E2E) down --remove-orphans -v

## Build → start app → run Playwright → full teardown. Always starts from a clean DB.
e2e:
	$(COMPOSE_E2E) down --remove-orphans -v
	$(COMPOSE_E2E) up -d --build backend frontend || \
		{ $(COMPOSE_E2E) logs db-seed; $(COMPOSE_E2E) down --remove-orphans -v; exit 1; }
	@$(COMPOSE_E2E) run --rm playwright; \
	EXIT=$$?; \
	$(COMPOSE_E2E) down --remove-orphans -v; \
	exit $$EXIT
