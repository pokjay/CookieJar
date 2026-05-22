-- migrate:up
SET search_path TO moneyman;

CREATE TABLE app_settings (
    id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
SET search_path TO moneyman;

DROP TABLE IF EXISTS app_settings;
