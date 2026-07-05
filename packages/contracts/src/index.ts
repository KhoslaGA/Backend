/** Catalog / redirect / events / awards contracts — merged from backend, July 5. */

// ---------- shared ----------
export type Tenant = 'toprates' | 'liferate' | 'termrates' | 'healthrate';
export type Network = 'visa' | 'mastercard' | 'amex';
export type CreditBand = 'none' | 'poor' | 'fair' | 'good' | 'excellent';
/** Catalog-side network incl. non-postback values; postback networks are ./marketing's AffiliateNetwork. */
export type CatalogAffiliateNetwork = 'fintel' | 'cj' | 'direct' | 'none';

/** Every payload carries this. Frontend production builds refuse to render mock:true. */
export interface Provenance {
  mock: boolean;
}

// ---------- card catalog ----------
export interface CardOffer {
  id: string;
  annualFeeCents: number;
  purchaseAprBps: number;
  cashAdvanceAprBps: number | null;
  balanceTransferAprBps: number | null;
  welcomeOfferText: string | null;
  welcomeOfferValueCents: number | null;
  /** category -> rate, e.g. { groceries: 3.0, base: 1.0 } */
  rewardsSummary: Record<string, number>;
  fxFeeBps: number;
  incomeRequirementCents: number | null;
  /** ISO timestamp — rendered as the fine-print date. Never absent. */
  verifiedAt: string;
  sourceUrl: string;
}

export interface CardSummary {
  id: string;
  slug: string;
  name: string;
  issuerName: string;
  issuerSlug: string;
  network: Network;
  imageKey: string | null;
  newcomerEligible: boolean;
  secured: boolean;
  minCreditBand: CreditBand;
  reviewSlug: string | null;
  currentOffer: CardOffer;
}

export interface CardListResponse extends Provenance {
  cards: CardSummary[];
  total: number;
}

export interface CardListQuery {
  category?: 'newcomers' | 'cash-back' | 'travel' | 'no-fee' | 'secured' | 'student' | 'no-fx-fee' | 'low-interest' | 'balance-transfer' | 'rewards';
  issuer?: string;
  network?: Network;
  limit?: number;
  offset?: number;
}

// ---------- redirector (/go/:cardId) ----------
/** Query params the frontend attaches to /go links — NerdWallet-schema attribution. */
export interface RedirectParams {
  /** cta context */
  cta?: 'apply_now_button' | 'product_image' | 'card_name_link' | 'compare_cta' | 'quiz_result';
  sec?: string;        // impression_section, e.g. 'roundup_summary_table'
  pos?: number;        // impression_position (0-based)
  pv?: string;         // pageview_id (uuid)
  d?: 'apply' | 'terms';
}

// ---------- events ----------
export interface ImpressionEvent {
  pageviewId: string;
  cardId: string;
  section: string;
  position: number;
  pageUrl: string;
}

export interface ImpressionBatch {
  events: ImpressionEvent[];
}

// ---------- awards ----------
export interface Award {
  categorySlug: string;
  year: number;
  winnerCardId: string;
  rationaleMd: string;
  /** Always present — schema forbids awards without methodology. */
  methodologyVersionId: string;
}

