// Pure unit tests — no DB, no server. node --test with tsx loader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, annualNetValueCents, scoreCard, match } from '../src/match/engine.ts';
import type { CardSummary } from '@ratefamily/contracts';

const mk = (over: Partial<CardSummary> & { offer?: Partial<CardSummary['currentOffer']> } = {}): CardSummary => ({
  id: 'x', slug: over.slug ?? 'test-card', name: 'Test', issuerName: 'T', issuerSlug: 't',
  network: 'visa', imageKey: null, newcomerEligible: false, secured: false,
  minCreditBand: 'fair', reviewSlug: null,
  ...over,
  currentOffer: {
    id: 'o', annualFeeCents: 0, purchaseAprBps: 2099, cashAdvanceAprBps: null,
    balanceTransferAprBps: null, welcomeOfferText: null, welcomeOfferValueCents: null,
    rewardsSummary: { base: 1.0 }, fxFeeBps: 250, incomeRequirementCents: null,
    verifiedAt: '2026-07-03T00:00:00Z', sourceUrl: 'DEV-FIXTURE://x',
    ...(over.offer ?? {}),
  },
});

const profile = (o = {}) => ({
  goal: 'cashback' as const, feeTolerance: 'any' as const,
  creditStanding: 'good' as const, monthlySpendCents: 200000,
  topCategory: 'groceries' as const, ...o,
});

test('T1 credit band gate: poor applicant filtered from good-band card', () => {
  assert.equal(eligible(mk({ minCreditBand: 'good' }), profile({ creditStanding: 'poor' })), false);
});

test('T2 credit band gate: excellent passes everything', () => {
  assert.equal(eligible(mk({ minCreditBand: 'excellent' }), profile({ creditStanding: 'excellent' })), true);
});

test('T3 fee tolerance none excludes fee cards', () => {
  assert.equal(eligible(mk({ offer: { annualFeeCents: 12000 } }), profile({ feeTolerance: 'none' })), false);
});

test('T4 fee tolerance under_120 boundary is inclusive', () => {
  assert.equal(eligible(mk({ offer: { annualFeeCents: 12000 } }), profile({ feeTolerance: 'under_120' })), true);
  assert.equal(eligible(mk({ offer: { annualFeeCents: 12001 } }), profile({ feeTolerance: 'under_120' })), false);
});

test('T5 newcomer goal hard-filters non-newcomer cards', () => {
  assert.equal(eligible(mk({ newcomerEligible: false }), profile({ goal: 'newcomer' })), false);
  assert.equal(eligible(mk({ newcomerEligible: true, minCreditBand: 'none' }), profile({ goal: 'newcomer' })), true);
});

test('T6 net value math: rewards + amortized welcome - fee', () => {
  // $2000/mo spend, 3% groceries (40% of spend), 1% base (60%), $200 welcome/2, $120 fee
  const c = mk({ offer: { rewardsSummary: { groceries: 3.0, base: 1.0 }, welcomeOfferValueCents: 20000, annualFeeCents: 12000 } });
  const nv = annualNetValueCents(c, profile());
  // 24000_00*0.4*0.03 + 24000_00*0.6*0.01 = 28800 + 14400 = 43200 + 10000 - 12000 = 41200
  assert.equal(nv, 41200);
});

test('T7 negative net value flagged in reasons', () => {
  const c = mk({ offer: { annualFeeCents: 60000, rewardsSummary: { base: 0.5 } } });
  const r = scoreCard(c, profile({ monthlySpendCents: 50000 }));
  assert.ok(r.reasons.some((x) => x.includes('fee may outweigh')));
});

test('T8 score bounded 0..100', () => {
  const rich = mk({ offer: { rewardsSummary: { cashback: 10, groceries: 10, base: 5 }, welcomeOfferValueCents: 100000, fxFeeBps: 0 } });
  const r = scoreCard(rich, profile({ monthlySpendCents: 1000000 }));
  assert.ok(r.score <= 100 && r.score >= 0);
});

test('T9 fx-free card earns bonus + reason', () => {
  const r = scoreCard(mk({ offer: { fxFeeBps: 0 } }), profile());
  assert.ok(r.reasons.some((x) => x.includes('foreign-exchange')));
});

test('T10 determinism: same input, identical output', () => {
  const cards = [mk({ slug: 'a' }), mk({ slug: 'b', offer: { rewardsSummary: { cashback: 2, base: 1 } } })];
  const r1 = JSON.stringify(match(cards, profile()));
  const r2 = JSON.stringify(match(cards, profile()));
  assert.equal(r1, r2);
});

test('T11 stable tie-break by slug when score and value equal', () => {
  const twins = [mk({ slug: 'zeta' }), mk({ slug: 'alpha' })];
  const r = match(twins, profile());
  assert.equal(r[0].card.slug, 'alpha');
});

test('T12 limit respected and ranking correct', () => {
  const cards = [
    mk({ slug: 'weak' }),
    mk({ slug: 'strong', offer: { rewardsSummary: { cashback: 4, groceries: 4, base: 1 }, welcomeOfferValueCents: 20000 } }),
    mk({ slug: 'mid', offer: { rewardsSummary: { cashback: 1, base: 1 } } }),
  ];
  const r = match(cards, profile(), 2);
  assert.equal(r.length, 2);
  assert.equal(r[0].card.slug, 'strong');
});
