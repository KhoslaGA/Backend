-- Migration 002: offer_watch + rf_jobs role
-- The differ role can ONLY read catalog and write its own watch table —
-- offer mutation is impossible by grant, not by convention.
BEGIN;

CREATE TABLE offer_watch (
  card_id         uuid PRIMARY KEY REFERENCES card(id),
  last_hash       text,
  status          text NOT NULL DEFAULT 'OK'
                  CHECK (status IN ('OK','NEEDS-VERIFICATION','FETCH-FAILED')),
  last_checked_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE ROLE rf_jobs LOGIN PASSWORD 'rf_jobs' NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT CONNECT ON DATABASE ratefamily TO rf_jobs;
GRANT USAGE ON SCHEMA public TO rf_jobs;
GRANT SELECT ON card, card_offer, tenant TO rf_jobs;
GRANT SELECT, INSERT, UPDATE ON offer_watch TO rf_jobs;
-- deliberately NO card_offer write grants: the differ cannot alter offers

-- offer_watch is operational (not consumer/tenant data): no RLS, single row per card
COMMIT;
