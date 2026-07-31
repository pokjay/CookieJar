-- Manual transactions carry the sign their source bank exported: the bank
-- accounts store expenses negative, the card accounts store them positive.
-- Every consumer that classified a row as "spend" by testing charged_amount > 0
-- therefore dropped bank-paid manual expenses (rent, daycare) on the floor.
--
-- transactions_manual already records the authoritative answer in
-- cash_flow_type; it just never reached the views. Expose it so callers can
-- classify manual rows by intent instead of by sign. Scraped rows have no
-- cash_flow_type and keep being classified by sign, which is consistent for
-- them.

-- migrate:up

CREATE OR REPLACE VIEW moneyman.combined_transactions AS
 SELECT t.unique_id,
    t.company_id,
    t.account,
    t.status,
    t.activity_date,
    t.charged_amount,
    t.charged_currency,
    t.original_amount,
    t.original_currency,
    t.description,
    t.memo,
    t.identifier,
    t.installments,
    t.raw,
    t.created_at,
    t.updated_at,
    NULL::text AS cash_flow_type
   FROM moneyman.transactions t
UNION
 SELECT tm.unique_id,
    NULL::text AS company_id,
    tm.account,
    NULL::text AS status,
    tm.activity_date,
    (('-1'::integer)::numeric * tm.charged_amount) AS charged_amount,
    tm.charged_currency,
    tm.original_amount,
    tm.original_currency,
    tm.description,
    NULL::text AS memo,
    tm.identifier,
    NULL::jsonb AS installments,
    NULL::jsonb AS raw,
    tm.created_at,
    tm.updated_at,
    -- cash_flow_type is an enum; the scraped branch contributes NULL::text, so
    -- cast here to give the UNION a single resolvable type.
    (tm.cash_flow_type)::text AS cash_flow_type
   FROM moneyman.transactions_manual tm
  WHERE (tm.show_in_transactions IS TRUE);

CREATE OR REPLACE VIEW moneyman.processed_transcations_with_categories AS
 SELECT t.unique_id,
    t.company_id,
    t.account,
    t.status,
    t.activity_date,
    (('-1'::integer)::numeric * t.charged_amount) AS charged_amount,
    t.charged_amount AS orignial_charged_amount,
    t.charged_currency,
    t.original_amount,
    t.original_currency,
    t.description,
    COALESCE(w.mapped_description, (t.description)::character varying) AS processed_description,
    dtc.category,
    dtc.subcategory,
    t.memo,
    t.identifier,
    t.installments,
    t.created_at,
    t.updated_at,
    t.cash_flow_type
   FROM ((moneyman.combined_transactions t
     LEFT JOIN moneyman.wolt_transactions_all_info w ON ((t.unique_id = w.unique_id)))
     LEFT JOIN moneyman.description_to_category dtc ON (((COALESCE(w.mapped_description, (t.description)::character varying))::text = dtc.description)));

-- migrate:down

DROP VIEW moneyman.processed_transcations_with_categories;
DROP VIEW moneyman.combined_transactions;

CREATE VIEW moneyman.combined_transactions AS
 SELECT t.unique_id,
    t.company_id,
    t.account,
    t.status,
    t.activity_date,
    t.charged_amount,
    t.charged_currency,
    t.original_amount,
    t.original_currency,
    t.description,
    t.memo,
    t.identifier,
    t.installments,
    t.raw,
    t.created_at,
    t.updated_at
   FROM moneyman.transactions t
UNION
 SELECT tm.unique_id,
    NULL::text AS company_id,
    tm.account,
    NULL::text AS status,
    tm.activity_date,
    (('-1'::integer)::numeric * tm.charged_amount) AS charged_amount,
    tm.charged_currency,
    tm.original_amount,
    tm.original_currency,
    tm.description,
    NULL::text AS memo,
    tm.identifier,
    NULL::jsonb AS installments,
    NULL::jsonb AS raw,
    tm.created_at,
    tm.updated_at
   FROM moneyman.transactions_manual tm
  WHERE (tm.show_in_transactions IS TRUE);

CREATE VIEW moneyman.processed_transcations_with_categories AS
 SELECT t.unique_id,
    t.company_id,
    t.account,
    t.status,
    t.activity_date,
    (('-1'::integer)::numeric * t.charged_amount) AS charged_amount,
    t.charged_amount AS orignial_charged_amount,
    t.charged_currency,
    t.original_amount,
    t.original_currency,
    t.description,
    COALESCE(w.mapped_description, (t.description)::character varying) AS processed_description,
    dtc.category,
    dtc.subcategory,
    t.memo,
    t.identifier,
    t.installments,
    t.created_at,
    t.updated_at
   FROM ((moneyman.combined_transactions t
     LEFT JOIN moneyman.wolt_transactions_all_info w ON ((t.unique_id = w.unique_id)))
     LEFT JOIN moneyman.description_to_category dtc ON (((COALESCE(w.mapped_description, (t.description)::character varying))::text = dtc.description)));
