-- Migration 003: rf_jobs cross-tenant READ policies.
-- The freshness differ is tenant-agnostic infrastructure: it must see all
-- cards to watch all source pages. Read-only visibility; write prohibition
-- on card_offer remains (no grants). Scoped to rf_jobs only.
BEGIN;
CREATE POLICY jobs_read_card  ON card       FOR SELECT TO rf_jobs USING (true);
CREATE POLICY jobs_read_offer ON card_offer FOR SELECT TO rf_jobs USING (true);
COMMIT;
