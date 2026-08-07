-- migrate:up
-- error_type alone ("generic-error") is what the UI showed, and it tells the
-- user nothing actionable. error_message holds the scraper's human-readable
-- explanation. It is never provider-supplied text: the sidecar matches the
-- library's raw message against a fixed catalogue and stores its own sentence
-- (see describeFailure in scraper/src/app.js), so no bank page text, session
-- token or transaction id lands in this column.
-- Schema-qualified, like every other migration here: dbmate pins search_path to
-- moneyman via its URL, but the integration fixture (tests/conftest.py) runs
-- these statements on a plain create_engine(TEST_DATABASE_URL) connection that
-- pins nothing, so an unqualified name would resolve against public and fail.
ALTER TABLE moneyman.scraper_run_accounts ADD COLUMN error_message text;

-- migrate:down
ALTER TABLE moneyman.scraper_run_accounts DROP COLUMN error_message;
