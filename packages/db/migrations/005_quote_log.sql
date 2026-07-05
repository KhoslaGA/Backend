-- Migration 005: quote_log — the proprietary dataset spine, PII-free by schema.
BEGIN;
CREATE TABLE quote_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  vertical       text NOT NULL CHECK (vertical IN ('auto','home','life','travel','commercial')),
  source         text NOT NULL CHECK (source IN ('mock','apollo','april','panel','compulife')),
  quote_ref      text,
  panel_size     integer,
  declined_count integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quote_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON quote_log TO rf_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO rf_app;
COMMIT;
