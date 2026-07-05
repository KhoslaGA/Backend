-- Migration 004: leads + CASL consent records
BEGIN;

CREATE TABLE consent_record (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  kind         text NOT NULL CHECK (kind IN ('casl_express','casl_implied')),
  wording      text NOT NULL,               -- exact consent text shown, immutable evidence
  page_url     text,
  granted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  vertical           text NOT NULL CHECK (vertical IN ('auto','home','life','travel','health','commercial','credit')),
  contact            jsonb NOT NULL,        -- ONLY PII column in the system; encrypt at rest in RDS
  renewal_month      integer CHECK (renewal_month BETWEEN 1 AND 12),
  consent_record_id  uuid NOT NULL REFERENCES consent_record(id),  -- no lead without consent
  routed_to          text NOT NULL DEFAULT 'nurture_pnc'
                     CHECK (routed_to IN ('klc_life','nurture_pnc','educational_only')),
  status             text NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','contacted','converted','closed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_renewal ON lead (tenant_id, vertical, renewal_month) WHERE status = 'new';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consent_record','lead'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id())
         WITH CHECK (tenant_id = current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO rf_app', t);
  END LOOP;
END $$;
-- rf_jobs deliberately gets NOTHING here: the differ and all agents are blind to PII by grant
COMMIT;
