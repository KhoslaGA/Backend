// Mock suite: persona expected-outcome baselines (exact assertions), determinism,
// TAC-honest panels, Compulife IP lock, chaos layer. Changing a persona outcome
// requires a PR explanation — these are the regression baseline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../../../packages/mocks/server.mjs';
import { quoteAuto, appetite } from '../../../packages/mocks/engines/auto.mjs';
import { quoteHome, compulifeQuote, _resetCompulifeState } from '../../../packages/mocks/engines/home-life.mjs';
import { PERSONAS } from '../../../packages/mocks/personas.mjs';

let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = async (path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------- engine units ----------
test('auto: P1 clean commuter — full 8-carrier panel, all quoted', () => {
  const r = quoteAuto(PERSONAS.P1_CLEAN_COMMUTER.auto);
  assert.equal(r.mock, true);
  assert.equal(r.panel.length, 8);
  assert.ok(r.panel.every((q) => q.status === 'quoted' && q.annualPremiumCents > 0));
  assert.ok(r.panel.every((q) => q.bindMethod === 'broker_assisted'));
});

test('auto: P3 high-risk — aviva/intact/definity decline, pembridge still quotes (TAC honest partial panel)', () => {
  const r = quoteAuto(PERSONAS.P3_HIGH_RISK.auto);
  const by = Object.fromEntries(r.panel.map((q) => [q.carrierCode, q]));
  assert.equal(by.aviva.status, 'declined');
  assert.equal(by.intact.status, 'declined');
  assert.equal(by.definity.status, 'declined');
  assert.ok(by.aviva.declineReason.length > 5, 'declines carry reasons — rendered, never suppressed');
  assert.equal(by.pembridge.status, 'quoted');
  assert.equal(r.panel.length, 8, 'declined carriers stay in the panel');
});

test('auto: P4 G2 student pays materially more than P1', () => {
  const p1 = quoteAuto(PERSONAS.P1_CLEAN_COMMUTER.auto).panel.find((q) => q.carrierCode === 'wawanesa');
  const p4 = quoteAuto(PERSONAS.P4_G2_STUDENT.auto).panel.find((q) => q.carrierCode === 'wawanesa');
  assert.ok(p4.annualPremiumCents > p1.annualPremiumCents * 1.5);
});

test('auto: determinism — identical profile, identical panel', () => {
  const a = JSON.stringify(quoteAuto(PERSONAS.P2_NEWCOMER.auto));
  const b = JSON.stringify(quoteAuto(PERSONAS.P2_NEWCOMER.auto));
  assert.equal(a, b);
});

test('auto: DCPD opt-out reduces premium, OPCF 49 raises it (O. Reg. 383/24 elections)', () => {
  const base_ = quoteAuto(PERSONAS.P1_CLEAN_COMMUTER.auto).panel[0].annualPremiumCents;
  const optOut = quoteAuto({ ...PERSONAS.P1_CLEAN_COMMUTER.auto,
    reformElections: { dcpdOptOut: true, opcf49IncomeReplacement: false } }).panel[0].annualPremiumCents;
  const opcf = quoteAuto({ ...PERSONAS.P1_CLEAN_COMMUTER.auto,
    reformElections: { dcpdOptOut: false, opcf49IncomeReplacement: true } }).panel[0].annualPremiumCents;
  assert.ok(optOut < base_);
  assert.ok(opcf > base_);
});

test('auto: renewal rate-capping holds premium at prior +10%', () => {
  const r = quoteAuto({ ...PERSONAS.P3_HIGH_RISK.auto, renewal: true, priorAnnualPremiumCents: 200000 });
  for (const q of r.panel.filter((x) => x.status === 'quoted'))
    assert.ok(q.annualPremiumCents <= 220000);
});

test('home: P5 Brampton homeowner — full panel incl. coverage differences', () => {
  const r = quoteHome(PERSONAS.P5_BRAMPTON_HOMEOWNER.home);
  assert.equal(r.panel.filter((q) => q.status === 'quoted').length, 8);
  const cov = r.panel.find((q) => q.carrierCode === 'travelers').coverage;
  assert.equal(cov.overlandFlood, false, 'coverage differences render, not just price');
});

test('home: oil heating declines exactly aviva/intact/wawanesa', () => {
  const r = quoteHome({ ...PERSONAS.P5_BRAMPTON_HOMEOWNER.home, heating: 'oil' });
  const declined = r.panel.filter((q) => q.status === 'declined').map((q) => q.carrierCode).sort();
  assert.deepEqual(declined, ['aviva', 'intact', 'wawanesa']);
});

test('compulife twin: missing REMOTE_IP errors exactly like the real API', () => {
  _resetCompulifeState();
  const r = compulifeQuote({ ...PERSONAS.P8_TERM_LIFE_35F.life });
  assert.equal(r.error, 'MISSING_REMOTE_IP');
});

test('compulife twin: second source IP locked out; smoker/CI priced up; results sorted', () => {
  _resetCompulifeState();
  const req8 = { ...PERSONAS.P8_TERM_LIFE_35F.life, REMOTE_IP: '1.2.3.4' };
  const ok = compulifeQuote(req8, { sourceIp: '99.1.1.1' });
  assert.ok(ok.results?.length === 12);
  const sorted = [...ok.results].sort((a, b) => a.monthlyPremiumCents - b.monthlyPremiumCents);
  assert.deepEqual(ok.results, sorted);
  const locked = compulifeQuote(req8, { sourceIp: '99.2.2.2' });
  assert.equal(locked.error, 'IP_LOCKED');
  _resetCompulifeState();
  const p8 = compulifeQuote(req8, { sourceIp: '99.1.1.1' }).results[0].monthlyPremiumCents;
  const p9 = compulifeQuote({ ...PERSONAS.P9_TERM_LIFE_62M_SMOKER.life, REMOTE_IP: '1.2.3.4' }, { sourceIp: '99.1.1.1' }).results[0].monthlyPremiumCents;
  assert.ok(p9 > p8 * 2, '62M smoker with CI far above 35F non-smoker');
});

// ---------- server integration ----------
test('server: auto quote over HTTP with all-decline scenario', async () => {
  const r = await post('/mock/rating/auto/quote', PERSONAS.P1_CLEAN_COMMUTER.auto, { 'X-Mock-Scenario': 'all-decline' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mock, true);
  assert.ok(r.body.panel.every((q) => q.status === 'declined'));
});

test('server: incomplete profile 400s', async () => {
  const r = await post('/mock/rating/auto/quote', { postalCode: 'M5V1A1' });
  assert.equal(r.status, 400);
});

test('server: chaos — error-500 and garbage scenarios', async () => {
  const e = await post('/mock/rating/home/quote', PERSONAS.P5_BRAMPTON_HOMEOWNER.home, { 'X-Mock-Scenario': 'error-500' });
  assert.equal(e.status, 500);
  const g = await post('/mock/rating/home/quote', PERSONAS.P5_BRAMPTON_HOMEOWNER.home, { 'X-Mock-Scenario': 'garbage' });
  assert.equal(g.body, null, 'garbage scenario returns unparseable body');
});

test('server: every successful payload carries mock:true', async () => {
  const a = await post('/mock/rating/auto/quote', PERSONAS.P2_NEWCOMER.auto);
  const h = await post('/mock/rating/home/quote', PERSONAS.P5_BRAMPTON_HOMEOWNER.home);
  await post('/mock/compulife/_reset', {});
  const l = await post('/mock/compulife/quote', { ...PERSONAS.P8_TERM_LIFE_35F.life, REMOTE_IP: '1.1.1.1' });
  for (const r of [a, h, l]) assert.equal(r.body.mock, true);
});
