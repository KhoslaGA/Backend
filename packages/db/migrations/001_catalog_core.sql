-- ============================================================
-- Rate Family · Migration 001 · Catalog core (Phase B1)
-- Rules enforced here, not in policy docs:
--   * tenant_id on every row, RLS enabled
--   * card_offer is append-only (trigger blocks UPDATE/DELETE)
--   * no award without a methodology version (FK, Bill C-59 chain)
--   * verified_at + source_url NOT NULL on offers
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- tenancy ----------
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,          -- toprates | liferate | termrates | healthrate
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- app role used by the API; RLS applies to it, not to migrations
DO $$ BEGIN
  CREATE ROLE rf_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- helper: current tenant from session setting
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------- issuers ----------
CREATE TABLE issuer (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  slug              text NOT NULL,
  name              text NOT NULL,
  affiliate_network text NOT NULL DEFAULT 'none'
                    CHECK (affiliate_network IN ('fintel','cj','direct','none')),
  program_status    text NOT NULL DEFAULT 'none'
                    CHECK (program_status IN ('none','applied','approved','paused')),
  default_epc_cents integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

-- ---------- cards ----------
CREATE TABLE card (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  issuer_id         uuid NOT NULL REFERENCES issuer(id),
  slug              text NOT NULL,
  name              text NOT NULL,
  network           text NOT NULL CHECK (network IN ('visa','mastercard','amex')),
  market            text NOT NULL DEFAULT 'CA' CHECK (market IN ('CA','US')),
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived')),
  image_key         text,                     -- S3 object key
  newcomer_eligible boolean NOT NULL DEFAULT false,
  secured           boolean NOT NULL DEFAULT false,
  min_credit_band   text NOT NULL DEFAULT 'fair'
                    CHECK (min_credit_band IN ('none','poor','fair','good','excellent')),
  review_slug       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX idx_card_issuer  ON card (issuer_id);
CREATE INDEX idx_card_lookup  ON card (tenant_id, status, market);

-- ---------- offers: append-only, versioned ----------
CREATE TABLE card_offer (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  card_id                   uuid NOT NULL REFERENCES card(id),
  annual_fee_cents          integer NOT NULL,
  purchase_apr_bps          integer NOT NULL,          -- 2099 = 20.99%
  cash_advance_apr_bps      integer,
  balance_transfer_apr_bps  integer,
  welcome_offer_text        text,
  welcome_offer_value_cents integer,
  rewards_summary           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"groceries": 3.0, "base": 1.0}
  fx_fee_bps                integer NOT NULL DEFAULT 250,
  income_requirement_cents  integer,
  verified_at               timestamptz NOT NULL,      -- substantiation: no unverified figure
  source_url                text NOT NULL,             -- substantiation: provenance required
  effective_from            timestamptz NOT NULL DEFAULT now(),
  superseded_by             uuid REFERENCES card_offer(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_offer_current ON card_offer (card_id) WHERE superseded_by IS NULL;

-- append-only enforcement: only supersession is allowed, nothing else changes, no deletes
CREATE OR REPLACE FUNCTION offer_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'card_offer is append-only: DELETE forbidden';
  END IF;
  IF (to_jsonb(NEW) - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by')
     OR OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'card_offer is append-only: only one-time supersession permitted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_offer_append_only
  BEFORE UPDATE OR DELETE ON card_offer
  FOR EACH ROW EXECUTE FUNCTION offer_append_only();

-- ---------- affiliate links: one card, many destinations ----------
CREATE TABLE affiliate_link (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  card_id           uuid NOT NULL REFERENCES card(id),
  destination       text NOT NULL DEFAULT 'apply'
                    CHECK (destination IN ('apply','terms')),
  url               text NOT NULL,
  network           text NOT NULL DEFAULT 'none'
                    CHECK (network IN ('fintel','cj','direct','none')),
  tracking_template text,                     -- e.g. '?subid={click_id}'
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_afflink_one_active
  ON affiliate_link (card_id, destination) WHERE active;

-- ---------- attribution: clicks & impressions (no PII by schema) ----------
CREATE TABLE click (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  card_id            uuid NOT NULL REFERENCES card(id),
  affiliate_link_id  uuid REFERENCES affiliate_link(id),  -- NULL = unmonetized fallback
  cta_type           text NOT NULL DEFAULT 'apply_now_button',
  impression_section text,
  impression_position integer,
  page_url           text,
  pageview_id        uuid,
  session_id         text,                    -- first-party cookie id, opaque
  user_agent_hash    text,
  referrer           text,
  monetizable        boolean NOT NULL DEFAULT true,
  clicked_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_click_card_time ON click (card_id, clicked_at);
CREATE INDEX idx_click_session   ON click (session_id, clicked_at);

CREATE TABLE impression (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  pageview_id  uuid NOT NULL,
  card_id      uuid NOT NULL REFERENCES card(id),
  section      text,
  position     integer,
  page_url     text,
  seen_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_impression_pv ON impression (pageview_id);

-- ---------- awards & methodology: substantiation as a constraint ----------
CREATE TABLE methodology_version (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  body_md      text NOT NULL,
  published_at timestamptz,
  approved_by  text,                          -- Clerk user id
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE award (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  category_slug          text NOT NULL,
  year                   integer NOT NULL,
  winner_card_id         uuid NOT NULL REFERENCES card(id),
  rationale_md           text NOT NULL,
  methodology_version_id uuid NOT NULL REFERENCES methodology_version(id), -- no methodology, no award
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category_slug, year)
);

-- ---------- RLS ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['issuer','card','card_offer','affiliate_link',
                           'click','impression','methodology_version','award']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id())
         WITH CHECK (tenant_id = current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO rf_app', t);
  END LOOP;
END $$;
GRANT SELECT ON tenant TO rf_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO rf_app;

COMMIT;
