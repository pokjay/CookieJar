COMPOSE      := docker compose
COMPOSE_APP  := $(COMPOSE) -f docker-compose.yml
COMPOSE_DEV  := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_DEVDB := $(COMPOSE) -f docker-compose.yml -f docker-compose.db.yml -f docker-compose.dev.yml
COMPOSE_E2E  := $(COMPOSE) -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.db.yml -f docker-compose.test.yml

.PHONY: up down logs dev dev-rebuild dev-db dev-down e2e e2e-up e2e-run e2e-down e2e-clean

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
