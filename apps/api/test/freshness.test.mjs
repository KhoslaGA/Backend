// Freshness differ suite: normalize/hash units + full runs against a local
// mutating "issuer page" + proof the rf_jobs role cannot write offers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { normalize, pageHash, runFreshnessCheck } from '../../../packages/jobs/freshness.mjs';

const psqlRoot = (sql) =>
  execSync(`psql -h localhost -U rf -d ratefamily -tAc "${sql.replace(/"/g, '\\"')}"`, {
    env: { ...process.env, PGPASSWORD: 'rf' },
  }).toString().trim();

let server, port, pageBody = '<html><body>Welcome offer: $200</body></html>';
let jobsPool, cardId;
const mdPath = mkdtempSync(`${tmpdir()}/freshness-`) + '/offers-review.md';
process.env.FRESHNESS_MD = mdPath;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/broken') { res.writeHead(500); return res.end('err'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(pageBody + `<script>analytics(${Math.random()})</script>`); // noise the normalizer must ignore
  });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;

  jobsPool = new pg.Pool({ host: 'localhost', user: 'rf_jobs', password: 'rf_jobs', database: 'ratefamily' });
  // idempotent reruns: clear watch state from prior suite executions
  psqlRoot("DELETE FROM offer_watch WHERE card_id IN (SELECT id FROM card WHERE slug='amex-cobalt')");

  // point one real card's offer at the local page via a fresh supersession (as rf superuser, simulating admin path)
  cardId = psqlRoot("SELECT id FROM card WHERE slug='amex-cobalt'");
  psqlRoot(`
    WITH prev AS (SELECT id FROM card_offer WHERE card_id='${cardId}' AND superseded_by IS NULL),
    ins AS (
      INSERT INTO card_offer (tenant_id, card_id, annual_fee_cents, purchase_apr_bps, rewards_summary, fx_fee_bps, verified_at, source_url)
      SELECT tenant_id, card_id, annual_fee_cents, purchase_apr_bps, rewards_summary, fx_fee_bps, now(), 'http://localhost:${port}/offer'
      FROM card_offer WHERE card_id='${cardId}' AND superseded_by IS NULL
      RETURNING id)
    UPDATE card_offer SET superseded_by = (SELECT id FROM ins) WHERE id = (SELECT id FROM prev)`);
});
after(async () => { server.close(); await jobsPool.end(); });

test('normalize strips scripts/styles/whitespace so analytics noise does not trigger flags', () => {
  const a = pageHash('<html><body>Offer: $200</body><script>x(1)</script></html>');
  const b = pageHash('<html><body>Offer:   $200</body><script>x(999)</script></html>');
  assert.equal(a, b);
  const c = pageHash('<html><body>Offer: $250</body></html>');
  assert.notEqual(a, c);
});

test('first run baselines, unchanged second run stays OK, no flags written', async () => {
  const r1 = await runFreshnessCheck({ pool: jobsPool });
  const watched = r1.flags.filter((f) => f.slug === 'amex-cobalt');
  assert.equal(watched.length, 0, 'first run baselines without flagging');
  const r2 = await runFreshnessCheck({ pool: jobsPool });
  assert.equal(r2.flags.filter((f) => f.slug === 'amex-cobalt').length, 0);
  assert.equal(psqlRoot(`SELECT status FROM offer_watch WHERE card_id='${cardId}'`), 'OK');
});

test('changed page -> NEEDS-VERIFICATION flag + markdown line; offer row untouched', async () => {
  const offerBefore = psqlRoot(`SELECT id FROM card_offer WHERE card_id='${cardId}' AND superseded_by IS NULL`);
  pageBody = '<html><body>Welcome offer: $300 — NEW!</body></html>';
  const r = await runFreshnessCheck({ pool: jobsPool });
  const flag = r.flags.find((f) => f.slug === 'amex-cobalt');
  assert.equal(flag?.status, 'NEEDS-VERIFICATION');
  assert.equal(psqlRoot(`SELECT status FROM offer_watch WHERE card_id='${cardId}'`), 'NEEDS-VERIFICATION');
  assert.ok(existsSync(mdPath) && readFileSync(mdPath, 'utf8').includes('[NEEDS-VERIFICATION] amex-cobalt'));
  // the differ detected but did NOT write: current offer id unchanged
  const offerAfter = psqlRoot(`SELECT id FROM card_offer WHERE card_id='${cardId}' AND superseded_by IS NULL`);
  assert.equal(offerAfter, offerBefore);
});

test('fetch failure -> FETCH-FAILED, honestly reported, never fabricated as a pass', async () => {
  psqlRoot(`
    WITH prev AS (SELECT id FROM card_offer WHERE card_id='${cardId}' AND superseded_by IS NULL),
    ins AS (
      INSERT INTO card_offer (tenant_id, card_id, annual_fee_cents, purchase_apr_bps, rewards_summary, fx_fee_bps, verified_at, source_url)
      SELECT tenant_id, card_id, annual_fee_cents, purchase_apr_bps, rewards_summary, fx_fee_bps, now(), 'http://localhost:${port}/broken'
      FROM card_offer WHERE card_id='${cardId}' AND superseded_by IS NULL RETURNING id)
    UPDATE card_offer SET superseded_by = (SELECT id FROM ins) WHERE id = (SELECT id FROM prev)`);
  const r = await runFreshnessCheck({ pool: jobsPool });
  const flag = r.flags.find((f) => f.slug === 'amex-cobalt');
  assert.equal(flag?.status, 'FETCH-FAILED');
  assert.equal(psqlRoot(`SELECT status FROM offer_watch WHERE card_id='${cardId}'`), 'FETCH-FAILED');
});

test('stale verified_at flagged regardless of page content', async () => {
  psqlRoot(`ALTER TABLE card_offer DISABLE TRIGGER trg_offer_append_only`);
  psqlRoot(`UPDATE card_offer SET verified_at = now() - interval '200 days' WHERE card_id='${cardId}' AND superseded_by IS NULL`);
  psqlRoot(`ALTER TABLE card_offer ENABLE TRIGGER trg_offer_append_only`);
  const r = await runFreshnessCheck({ pool: jobsPool });
  assert.ok(r.flags.some((f) => f.slug === 'amex-cobalt' && f.status === 'STALE-VERIFICATION'));
});

test('rf_jobs role CANNOT write card_offer — prohibition is a grant, not a convention', async () => {
  await assert.rejects(
    jobsPool.query(`UPDATE card_offer SET superseded_by = NULL WHERE card_id = $1`, [cardId]),
    /permission denied/);
  await assert.rejects(
    jobsPool.query(`INSERT INTO card_offer (tenant_id, card_id, annual_fee_cents, purchase_apr_bps, rewards_summary, fx_fee_bps, verified_at, source_url)
                    SELECT tenant_id, card_id, 0, 999, '{}', 0, now(), 'https://evil.test' FROM card_offer LIMIT 1`),
    /permission denied/);
});
