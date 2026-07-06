-- migrate:up

CREATE TABLE moneyman.scraper_runs (
    id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    started_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
    finished_at   TIMESTAMPTZ,
    status        TEXT        NOT NULL CHECK (status IN ('running', 'success', 'partial', 'error')),
    lookback_days INTEGER     NOT NULL
);

-- Enforces at most one running sync at a time at the DB level.
CREATE UNIQUE INDEX scraper_runs_one_running
    ON moneyman.scraper_runs (status)
    WHERE status = 'running';

CREATE TABLE moneyman.scraper_run_accounts (
    id                    UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id                UUID    NOT NULL REFERENCES moneyman.scraper_runs(id),
    account               TEXT    NOT NULL,
    company_id            TEXT    NOT NULL,
    status                TEXT    NOT NULL CHECK (status IN ('pending', 'success', 'error')),
    error_type            TEXT,
    transactions_imported INTEGER NOT NULL DEFAULT 0
);

-- migrate:down

DROP TABLE IF EXISTS moneyman.scraper_run_accounts;
DROP TABLE IF EXISTS moneyman.scraper_runs;
