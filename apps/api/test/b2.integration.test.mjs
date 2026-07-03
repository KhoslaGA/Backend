// B2 integration: match endpoint, compare, impression batching, offer supersession.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://localhost:3102';
let api;
const psql = (sql) =>
  execSync(`psql -h localhost -U rf -d ratefamily -tAc "${sql.replace(/"/g, '\\"')}"`, {
    env: { ...process.env, PGPASSWORD: 'rf' },
  }).toString().trim();

const req = async (method, path, body, tenant = 'toprates', auth = true) => {
  const headers = { 'x-tenant': tenant, 'content-type': 'application/json' };
  if (path.startsWith('/admin') && auth) headers['authorization'] = 'Bearer test-admin-token';
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  api = spawn('node_modules/.bin/tsx', ['apps/api/src/main.ts'], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env: { ...process.env, PORT: '3102', PGUSER: 'rf_api', PGPASSWORD: 'rf_api', ADMIN_TOKEN: 'test-admin-token' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try { await fetch(BASE + '/v1/cards', { headers: { 'x-tenant': 'toprates' } }); return; }
    catch { await sleep(500); }
  }
  throw new Error('API failed to boot');
});
after(() => api?.kill());

test('match: newcomer profile returns only newcomer-eligible cards with reasons', async () => {
  const { status, body } = await req('POST', '/v1/match', {
    goal: 'newcomer', feeTolerance: 'none', creditStanding: 'none',
    monthlySpendCents: 150000, topCategory: 'groceries',
  });
  assert.equal(status, 201);
  assert.ok(body.results.length >= 1);
  for (const r of body.results) {
    assert.equal(r.card.newcomerEligible, true);
    assert.equal(r.card.currentOffer.annualFeeCents, 0);
    assert.ok(r.reasons.length >= 1);
    assert.ok(r.score >= 0 && r.score <= 100);
  }
});

test('match: results are deterministic across calls', async () => {
  const p = { goal: 'cashback', feeTolerance: 'any', creditStanding: 'good', monthlySpendCents: 250000, topCategory: 'groceries' };
  const a = await req('POST', '/v1/match', p);
  const b = await req('POST', '/v1/match', p);
  assert.deepEqual(a.body, b.body);
});

test('compare: preserves requested order, 404s on unknown id', async () => {
  const { body: list } = await req('GET', '/v1/cards?limit=3');
  const [a, b] = list.cards;
  const r = await req('GET', `/v1/cards/compare?ids=${b.id},${a.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.cards.map((c) => c.id), [b.id, a.id]);
  const bad = await req('GET', `/v1/cards/compare?ids=${a.id},00000000-0000-4000-8000-000000000000`);
  assert.equal(bad.status, 404);
});

test('impressions: batch accepted and persisted', async () => {
  const { body: list } = await req('GET', '/v1/cards?limit=2');
  const pv = crypto.randomUUID();
  const before_ = Number(psql('SELECT count(*) FROM impression'));
  const r = await req('POST', '/v1/events/impressions', {
    events: list.cards.map((c, i) => ({
      pageviewId: pv, cardId: c.id, section: 'test_suite', position: i, pageUrl: '/test',
    })),
  });
  assert.equal(r.status, 202);
  assert.equal(r.body.accepted, 2);
  assert.equal(Number(psql('SELECT count(*) FROM impression')), before_ + 2);
});

test('admin supersession: new offer becomes current, old superseded, history intact', async () => {
  const { body: list } = await req('GET', '/v1/cards?issuer=tangerine&limit=1');
  const card = list.cards[0];
  const oldOfferId = card.currentOffer.id;
  const r = await req('POST', '/admin/offers', {
    cardId: card.id, annualFeeCents: 0, purchaseAprBps: 1995,
    rewardsSummary: { cashback: 2.0, base: 0.5 }, fxFeeBps: 250,
    welcomeOfferText: 'Updated offer', welcomeOfferValueCents: 12500,
    verifiedAt: new Date().toISOString(), sourceUrl: 'https://www.tangerine.ca/en/products/spending/creditcard',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.supersededOfferId, oldOfferId);
  // catalog now serves the new offer
  const { body: after_ } = await req('GET', '/v1/cards?issuer=tangerine&limit=1');
  assert.equal(after_.cards[0].currentOffer.id, r.body.offerId);
  assert.equal(after_.cards[0].currentOffer.welcomeOfferValueCents, 12500);
  // history: exactly one non-superseded offer for the card; old row still exists
  assert.equal(psql(`SELECT count(*) FROM card_offer WHERE card_id='${card.id}' AND superseded_by IS NULL`), '1');
  assert.equal(psql(`SELECT count(*) FROM card_offer WHERE id='${oldOfferId}'`), '1');
});

test('admin supersession: rejects missing verification and DEV-FIXTURE sources', async () => {
  const { body: list } = await req('GET', '/v1/cards?limit=1');
  const noVerify = await req('POST', '/admin/offers', {
    cardId: list.cards[0].id, annualFeeCents: 0, purchaseAprBps: 1999,
    rewardsSummary: { base: 1 }, fxFeeBps: 250, sourceUrl: 'https://x.test',
  });
  assert.equal(noVerify.status, 400);
  const fixture = await req('POST', '/admin/offers', {
    cardId: list.cards[0].id, annualFeeCents: 0, purchaseAprBps: 1999,
    rewardsSummary: { base: 1 }, fxFeeBps: 250,
    verifiedAt: new Date().toISOString(), sourceUrl: 'DEV-FIXTURE://sneaky',
  });
  assert.equal(fixture.status, 400);
});

test('admin guard: missing or wrong token -> 401', async () => {
  const none = await req('POST', '/admin/offers', { cardId: 'x' }, 'toprates', false);
  assert.equal(none.status, 401);
  const wrong = await fetch(BASE + '/admin/offers', {
    method: 'POST',
    headers: { 'x-tenant': 'toprates', 'content-type': 'application/json', authorization: 'Bearer nope' },
    body: JSON.stringify({ cardId: 'x' }),
  });
  assert.equal(wrong.status, 401);
});
