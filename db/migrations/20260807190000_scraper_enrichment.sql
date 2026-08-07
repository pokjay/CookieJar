-- migrate:up
-- The provider's own category for a transaction (isracard/amex trim it out of
-- PirteyIska_204Bean.sector; visaCal supplies branchCodeDesc natively). Until
-- now it survived only inside the raw JSONB blob, reachable by nothing, which
-- made the enrichment pass that costs ~90% of a scrape's requests worth nothing
-- (#149) — and made "which transactions still need enriching" unanswerable, so
-- every sync re-enriched everything it had already paid for.
--
-- Deliberately NOT promoted alongside it: PirteyIska_204Bean.info, which
-- carries the cardholder's name and account number (#136).
-- Schema-qualified, like every other migration here: dbmate pins search_path to
-- moneyman via its URL, but the integration fixture (tests/conftest.py) runs
-- these statements on a plain create_engine(TEST_DATABASE_URL) connection that
-- pins nothing, so an unqualified name would resolve against public and fail.
ALTER TABLE moneyman.transactions ADD COLUMN bank_category text;

-- Every sync asks "what in this window is still unenriched" to build the
-- sidecar's skip set and the count the UI shows. Partial, because the rows that
-- matter are exactly the NULL ones, and that set shrinks toward empty as
-- enrichment converges — so the index stays small precisely as the table grows.
CREATE INDEX transactions_pending_enrichment_idx
    ON moneyman.transactions (company_id, activity_date)
    WHERE bank_category IS NULL;

-- Enrichment is budgeted and stops when the budget runs out, so a run finishing
-- successfully no longer means every transaction got a category. These carry
-- that fact to the UI: how many this run added, and how many are still missing
-- in the window that was scraped.
--
-- Nullable, and NULL means "enrichment did not apply here" — the caller did not
-- ask for it, or the provider has no such pass (max, visaCal). That is what
-- stops those accounts from displaying a counter that can never reach zero.
ALTER TABLE moneyman.scraper_run_accounts ADD COLUMN enrichment_added integer;
ALTER TABLE moneyman.scraper_run_accounts ADD COLUMN enrichment_missing integer;

-- migrate:down
ALTER TABLE moneyman.scraper_run_accounts DROP COLUMN enrichment_missing;
ALTER TABLE moneyman.scraper_run_accounts DROP COLUMN enrichment_added;
DROP INDEX moneyman.transactions_pending_enrichment_idx;
ALTER TABLE moneyman.transactions DROP COLUMN bank_category;
