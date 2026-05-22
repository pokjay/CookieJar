-- migrate:up
CREATE TABLE moneyman.app_settings (
    id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE IF EXISTS moneyman.app_settings;
