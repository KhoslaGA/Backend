# Rate Family Backend — Phase B1 (built & tested July 3, 2026)

Working slice of the backend plan: catalog + redirector on Postgres with
tenant RLS. All compliance rules are schema-enforced. 8/8 integration tests pass.

## What's here
- `packages/contracts` — shared TS types (frontend, mocks, and API all import these)
- `packages/db/migrations/001_catalog_core.sql` — tenancy, issuers, cards,
  append-only versioned offers, affiliate links, clicks/impressions, awards+methodology, RLS
- `packages/db/seed/seed.mjs` — 12 DEV-FIXTURE cards (source_url marked DEV-FIXTURE://
  so fixtures can never pass as verified data)
- `apps/api` — NestJS: `GET /v1/cards` (category/issuer/network filters, current-offer join)
  and `GET /go/:cardId` (attribution-logging redirector with unmonetized fallback)
- `apps/api/test/integration.test.mjs` — boots the API, verifies filters, RLS
  isolation, both redirect paths, click attribution, and that the DB role cannot bypass RLS

## Setup
```bash
npm install
# Postgres: create superuser 'rf' for migrations, then:
node packages/db/migrate.mjs
psql -U rf -d ratefamily -c "INSERT INTO tenant (slug,name) VALUES ('toprates','TopRates.ca'),('liferate','LifeRate.ca'),('termrates','TermRates.ca'),('healthrate','HealthRate.ca') ON CONFLICT DO NOTHING;"
psql -U rf -d ratefamily -c "CREATE ROLE rf_api LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS IN ROLE rf_app; GRANT CONNECT ON DATABASE ratefamily TO rf_api; GRANT USAGE ON SCHEMA public TO rf_app;"
node packages/db/seed/seed.mjs
PGUSER=rf_api PGPASSWORD=... npx tsx apps/api/src/main.ts   # port 3001
node --test 'apps/api/test/*.test.mjs'
```

## Rules enforced by schema (verified by live tests)
1. `card_offer` append-only — UPDATE/DELETE blocked by trigger; only one-time supersession allowed
2. No award without `methodology_version_id` (Bill C-59 substantiation as FK)
3. `verified_at` + `source_url` NOT NULL on every offer
4. RLS on all tenant tables; **API must connect as `rf_api` (NOSUPERUSER NOBYPASSRLS)** —
   test 5 asserts this because a superuser connection silently disables isolation
5. Redirector: components pass card IDs; affiliate URLs exist only in `affiliate_link`;
   subid = click id (postback reconciliation key); fallback path logs `monetizable=false`

## Known deltas vs. production
- tsx/esbuild strips decorator metadata → controllers use explicit `@Inject(DbService)`.
  Keep this pattern or build with `tsc` in prod.
- No auth/Clerk yet (Phase B2 admin), no impression batching endpoint yet (B3),
  no BullMQ (B2 freshness pipeline). Sequenced per the backend plan.
- Tenant slug comes from `x-tenant` header for now; in prod the middleware/host
  mapping (PR #17 pattern) supplies it.
