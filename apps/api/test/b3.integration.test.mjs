// B3: awards chain (methodology-first workflow) + leads intake (CASL evidence, routing).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://localhost:3103';
let api;
const psql = (sql) =>
  execSync(`psql -h localhost -U rf -d ratefamily -tAc "${sql.replace(/"/g, '\\"')}"`, {
    env: { ...process.env, PGPASSWORD: 'rf' },
  }).toString().trim();

const req = async (method, path, body, auth = false) => {
  const headers = { 'x-tenant': 'toprates', 'content-type': 'application/json' };
  if (auth) headers['authorization'] = 'Bearer test-admin-token';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  api = spawn('node_modules/.bin/tsx', ['apps/api/src/main.ts'], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env: { ...process.env, PORT: '3103', PGUSER: 'rf_api', PGPASSWORD: 'rf_api', ADMIN_TOKEN: 'test-admin-token' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try { await fetch(BASE + '/v1/cards', { headers: { 'x-tenant': 'toprates' } }); return; }
    catch { await sleep(500); }
  }
  throw new Error('API failed to boot');
});
after(() => api?.kill());

const METHODOLOGY = `## Best of 2026 methodology
We evaluate every card in our catalog on verified offer data only: net annual value at
three spend profiles, fee-to-reward ratio, welcome offer realizability, FX costs, and
eligibility breadth. Figures come exclusively from issuer pages with verification dates;
compensation never affects ratings. Full scoring weights are published below.` ;

test('award chain: methodology publishes, award created, public endpoint serves both together', async () => {
  const m = await req('POST', '/admin/awards/methodology', { bodyMd: METHODOLOGY, approvedBy: 'gautam' }, true);
  assert.equal(m.status, 201);
  const cardId = psql("SELECT id FROM card WHERE slug='tangerine-money-back'");
  const a = await req('POST', '/admin/awards', {
    categorySlug: 'best-no-fee-cash-back', year: 2026, winnerCardId: cardId,
    rationaleMd: 'Highest verified net value among zero-fee cash-back cards at typical spend profiles.',
    methodologyVersionId: m.body.methodologyVersionId,
  }, true);
  assert.equal(a.status, 201);
  const pub = await req('GET', '/v1/awards?year=2026');
  const award = pub.body.awards.find((x) => x.category_slug === 'best-no-fee-cash-back');
  assert.equal(award.winner_slug, 'tangerine-money-back');
  assert.ok(award.methodology_md.includes('scoring weights'), 'methodology travels with the award');
});

test('award chain: thin methodology rejected; award without methodology rejected', async () => {
  const thin = await req('POST', '/admin/awards/methodology', { bodyMd: 'we picked good cards', approvedBy: 'x' }, true);
  assert.equal(thin.status, 400);
  const cardId = psql("SELECT id FROM card WHERE slug='neo-credit'");
  const noMeth = await req('POST', '/admin/awards', {
    categorySlug: 'best-newcomer', year: 2026, winnerCardId: cardId,
    rationaleMd: 'A perfectly reasonable rationale that is long enough to pass the length check.',
  }, true);
  assert.equal(noMeth.status, 400);
});

test('award chain: admin award endpoints require auth', async () => {
  const r = await req('POST', '/admin/awards/methodology', { bodyMd: METHODOLOGY, approvedBy: 'x' }, false);
  assert.equal(r.status, 401);
});

test('leads: life lead routes to klc_life with consent recorded in same transaction', async () => {
  const r = await req('POST', '/v1/leads', {
    vertical: 'life',
    contact: { name: 'Test Person', email: 'test@example.com' },
    consent: { wording: 'I agree to be contacted by a licensed KLC Group advisor about life insurance.', pageUrl: '/life' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.routedTo, 'klc_life');
  const consent = psql(`SELECT cr.wording FROM lead l JOIN consent_record cr ON cr.id = l.consent_record_id WHERE l.id='${r.body.leadId}'`);
  assert.ok(consent.includes('licensed KLC Group advisor'), 'verbatim CASL wording stored as evidence');
});

test('leads: auto lead banks renewal month, routes to nurture (no P&C sales pre-RIBO)', async () => {
  const r = await req('POST', '/v1/leads', {
    vertical: 'auto', contact: { phone: '9055551234' }, renewalMonth: 11,
    consent: { wording: 'Notify me when TopRates.ca can offer auto insurance quotes; contact me near my renewal.' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.routedTo, 'nurture_pnc');
  assert.equal(psql(`SELECT renewal_month FROM lead WHERE id='${r.body.leadId}'`), '11');
});

test('leads: no consent wording -> rejected; no contact -> rejected', async () => {
  const noConsent = await req('POST', '/v1/leads', {
    vertical: 'life', contact: { email: 'x@y.com' }, consent: { wording: 'ok' },
  });
  assert.equal(noConsent.status, 400);
  const noContact = await req('POST', '/v1/leads', {
    vertical: 'life', contact: {}, consent: { wording: 'I agree to be contacted about life insurance products.' },
  });
  assert.equal(noContact.status, 400);
});

test('leads: rf_jobs role is blind to PII by grant', async () => {
  const denied = execSync(
    `psql -h localhost -U rf_jobs -d ratefamily -tAc "SELECT count(*) FROM lead" 2>&1 || true`,
    { env: { ...process.env, PGPASSWORD: 'rf_jobs' } }).toString();
  assert.match(denied, /permission denied/);
});
