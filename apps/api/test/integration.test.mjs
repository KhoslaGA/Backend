// Integration suite: boots the API as a child process against local Postgres
// (rf_api role — non-superuser so RLS is actually exercised) and verifies:
// catalog, category filters, tenant isolation, redirector paths, click attribution.
// Run: node --test apps/api/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://localhost:3101';
let api;

const psql = (sql) =>
  execSync(`psql -h localhost -U rf -d ratefamily -tAc "${sql.replace(/"/g, '\\"')}"`, {
    env: { ...process.env, PGPASSWORD: 'rf' },
  }).toString().trim();

const get = async (path, tenant = 'toprates') => {
  const res = await fetch(BASE + path, { headers: { 'x-tenant': tenant }, redirect: 'manual' });
  return res;
};
const json = async (path, tenant) => (await get(path, tenant)).json();

before(async () => {
  api = spawn('node_modules/.bin/tsx', ['apps/api/src/main.ts'], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env: { ...process.env, PORT: '3101', PGUSER: 'rf_api', PGPASSWORD: 'rf_api' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try { await fetch(BASE + '/v1/cards', { headers: { 'x-tenant': 'toprates' } }); return; }
    catch { await sleep(500); }
  }
  throw new Error('API failed to boot');
});
after(() => api?.kill());

test('catalog returns cards with verified offers, mock:false', async () => {
  const d = await json('/v1/cards?limit=3');
  assert.equal(d.mock, false);
  assert.ok(d.total >= 12);
  for (const c of d.cards) {
    assert.ok(c.currentOffer.verifiedAt, 'every offer carries verified_at');
    assert.ok(c.currentOffer.sourceUrl, 'every offer carries source_url');
  }
});

test('newcomers category filters correctly', async () => {
  const d = await json('/v1/cards?category=newcomers');
  assert.ok(d.total >= 5);
  assert.ok(d.cards.every((c) => c.newcomerEligible));
});

test('no-fee category returns only zero-fee offers', async () => {
  const d = await json('/v1/cards?category=no-fee');
  assert.ok(d.cards.every((c) => c.currentOffer.annualFeeCents === 0));
});

test('RLS: liferate tenant sees zero toprates cards', async () => {
  const d = await json('/v1/cards', 'liferate');
  assert.equal(d.total, 0);
});

test('RLS is enforced by a non-superuser connection', () => {
  const bypass = psql("SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname='rf_api'");
  assert.equal(bypass, 'f', 'rf_api must not bypass RLS — superuser connections silently disable isolation');
});

test('redirector: monetized card 302s with subid = click id', async () => {
  const { cards } = await json('/v1/cards?issuer=scotiabank&limit=1');
  const before_ = Number(psql('SELECT count(*) FROM click'));
  const res = await get(`/go/${cards[0].id}?cta=apply_now_button&sec=test_suite&pos=0`);
  assert.equal(res.status, 302);
  const loc = res.headers.get('location');
  assert.match(loc, /subid=[0-9a-f-]{36}/);
  await sleep(400); // fire-and-forget write settles
  const after_ = Number(psql('SELECT count(*) FROM click'));
  assert.equal(after_, before_ + 1, 'click row logged');
  const subid = loc.match(/subid=([0-9a-f-]{36})/)[1];
  const mon = psql(`SELECT monetizable FROM click WHERE id='${subid}'`);
  assert.equal(mon, 't', 'click id in URL matches the logged row (postback reconciliation key)');
});

test('redirector: card without active link falls back, logged monetizable=false', async () => {
  const { cards } = await json('/v1/cards?issuer=tangerine&limit=1');
  const res = await get(`/go/${cards[0].id}?cta=product_image&sec=test_suite&pos=1`);
  assert.equal(res.status, 302);
  await sleep(400);
  const mon = psql(
    `SELECT monetizable FROM click WHERE card_id='${cards[0].id}' ORDER BY clicked_at DESC LIMIT 1`);
  assert.equal(mon, 'f');
});

test('redirector: unknown card 404s and logs nothing', async () => {
  const before_ = Number(psql('SELECT count(*) FROM click'));
  const res = await get('/go/00000000-0000-4000-8000-000000000000');
  assert.equal(res.status, 404);
  const after_ = Number(psql('SELECT count(*) FROM click'));
  assert.equal(after_, before_);
});
