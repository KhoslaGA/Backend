/**
 * Match engine — pure, deterministic, no I/O. Same discipline as quote engine.ts:
 * fully unit-testable, DB rows in, ranked results out.
 *
 * Pipeline: hard filters (eligibility) -> score (fit) -> rank.
 * No EPC/revenue input here by design: editorial ranking stays walled off
 * from monetization at the module boundary. A revenue-aware tiebreaker, if
 * ever added, lives in a separate, disclosed layer — never in this file.
 */
import type { CardSummary, CreditBand } from '@ratefamily/contracts';

export interface MatchProfile {
  goal: 'cashback' | 'travel' | 'build_credit' | 'low_interest' | 'newcomer';
  feeTolerance: 'none' | 'under_120' | 'any';
  creditStanding: CreditBand;      // self-reported
  monthlySpendCents: number;       // approximate total card spend
  topCategory: 'groceries' | 'travel' | 'gas' | 'dining' | 'other';
}

export interface MatchResult {
  card: CardSummary;
  score: number;                   // 0..100, deterministic
  reasons: string[];               // plain-English, rendered in quiz results
}

const BAND_ORDER: CreditBand[] = ['none', 'poor', 'fair', 'good', 'excellent'];
const bandGte = (have: CreditBand, need: CreditBand) =>
  BAND_ORDER.indexOf(have) >= BAND_ORDER.indexOf(need);

export function eligible(card: CardSummary, p: MatchProfile): boolean {
  if (!bandGte(p.creditStanding, card.minCreditBand)) return false;
  if (p.feeTolerance === 'none' && card.currentOffer.annualFeeCents > 0) return false;
  if (p.feeTolerance === 'under_120' && card.currentOffer.annualFeeCents > 12000) return false;
  if (p.goal === 'newcomer' && !card.newcomerEligible) return false;
  if (p.goal === 'build_credit' && !(card.secured || bandGte('poor', card.minCreditBand))) return false;
  return true;
}

/** Annualized net value in cents: rewards on spend + welcome amortized - fee. */
export function annualNetValueCents(card: CardSummary, p: MatchProfile): number {
  const o = card.currentOffer;
  const annualSpend = p.monthlySpendCents * 12;
  // assume 40% of spend lands in the user's top category when the card rewards it
  const topRate = o.rewardsSummary[p.topCategory] ?? o.rewardsSummary['base'] ?? 0;
  const baseRate = o.rewardsSummary['base'] ?? 0;
  const rewards = annualSpend * 0.4 * (topRate / 100) + annualSpend * 0.6 * (baseRate / 100);
  const welcome = (o.welcomeOfferValueCents ?? 0) / 2; // amortize over 2 years
  return Math.round(rewards + welcome - o.annualFeeCents);
}

export function scoreCard(card: CardSummary, p: MatchProfile): MatchResult {
  const o = card.currentOffer;
  const reasons: string[] = [];
  let score = 0;

  // goal fit: 0-40
  const goalFit: Record<MatchProfile['goal'], (c: CardSummary) => number> = {
    cashback:     (c) => (c.currentOffer.rewardsSummary['cashback'] ? 40 : 10),
    travel:       (c) => (c.currentOffer.rewardsSummary['travel'] ? 40 : 10),
    newcomer:     (c) => (c.newcomerEligible ? 40 : 0),
    build_credit: (c) => (c.secured ? 40 : 25),
    low_interest: (c) => Math.max(0, 40 - Math.round((c.currentOffer.purchaseAprBps - 1299) / 25)),
  };
  const gf = goalFit[p.goal](card);
  score += gf;
  if (gf >= 40) reasons.push(`Strong fit for your ${p.goal.replace('_', ' ')} goal`);

  // net value: 0-40, scaled against $600/yr ceiling
  const nv = annualNetValueCents(card, p);
  const nvScore = Math.max(0, Math.min(40, Math.round((nv / 60000) * 40)));
  score += nvScore;
  if (nv > 0) reasons.push(`Estimated ${Math.round(nv / 100)}$/yr net value at your spend`);
  else reasons.push('Annual fee may outweigh rewards at your spend level');

  // category bonus: 0-10
  if ((o.rewardsSummary[p.topCategory] ?? 0) >= 2) {
    score += 10;
    reasons.push(`Earns accelerated rewards on ${p.topCategory}`);
  }

  // friction penalties
  if (o.fxFeeBps === 0) { score += 5; reasons.push('No foreign-exchange fee'); }
  if (o.incomeRequirementCents && o.incomeRequirementCents > 6000000) score -= 5;

  return { card, score: Math.max(0, Math.min(100, score)), reasons };
}

/** Deterministic tie-break: score desc, then net value desc, then slug asc (stable). */
export function match(cards: CardSummary[], p: MatchProfile, limit = 5): MatchResult[] {
  return cards
    .filter((c) => eligible(c, p))
    .map((c) => scoreCard(c, p))
    .sort((a, b) =>
      b.score - a.score ||
      annualNetValueCents(b.card, p) - annualNetValueCents(a.card, p) ||
      a.card.slug.localeCompare(b.card.slug))
    .slice(0, limit);
}
