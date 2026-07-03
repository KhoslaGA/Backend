import { Controller, Get, Headers, Inject, NotFoundException, Query } from '@nestjs/common';
import type { CardListResponse, CardSummary } from '@ratefamily/contracts';
import { DbService } from '../common/db.service.js';

const CATEGORY_SQL: Record<string, string> = {
  // category filters are SQL fragments over card + current offer (co)
  'newcomers':        'c.newcomer_eligible = true',
  'no-fee':           'co.annual_fee_cents = 0',
  'secured':          'c.secured = true',
  'no-fx-fee':        'co.fx_fee_bps = 0',
  'low-interest':     'co.purchase_apr_bps <= 1399',
  'balance-transfer': 'co.balance_transfer_apr_bps IS NOT NULL AND co.balance_transfer_apr_bps <= 500',
  'cash-back':        "co.rewards_summary ? 'cashback'",
  'travel':           "co.rewards_summary ? 'travel'",
  'student':          "c.min_credit_band IN ('none','poor')",
  'rewards':          "co.rewards_summary <> '{}'::jsonb",
};

@Controller('v1/cards')
export class CatalogController {
  constructor(@Inject(DbService) private db: DbService) {}

  @Get()
  async list(
    @Headers('x-tenant') tenantSlug = 'toprates',
    @Query('category') category?: string,
    @Query('issuer') issuer?: string,
    @Query('network') network?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ): Promise<CardListResponse> {
    const tenantId = await this.db.tenantId(tenantSlug);
    if (!tenantId) throw new NotFoundException('unknown tenant');

    const where: string[] = ["c.status = 'active'", 'co.superseded_by IS NULL'];
    const params: unknown[] = [];
    if (category && CATEGORY_SQL[category]) where.push(CATEGORY_SQL[category]);
    if (issuer)  { params.push(issuer);  where.push(`i.slug = $${params.length}`); }
    if (network) { params.push(network); where.push(`c.network = $${params.length}`); }
    params.push(Math.min(Number(limit) || 50, 100));
    const limIdx = params.length;
    params.push(Number(offset) || 0);
    const offIdx = params.length;

    const rows = await this.db.withTenant(tenantId, (c) =>
      c.query(
        `SELECT c.id, c.slug, c.name, c.network, c.image_key,
                c.newcomer_eligible, c.secured, c.min_credit_band, c.review_slug,
                i.name AS issuer_name, i.slug AS issuer_slug,
                co.id AS offer_id, co.annual_fee_cents, co.purchase_apr_bps,
                co.cash_advance_apr_bps, co.balance_transfer_apr_bps,
                co.welcome_offer_text, co.welcome_offer_value_cents,
                co.rewards_summary, co.fx_fee_bps, co.income_requirement_cents,
                co.verified_at, co.source_url,
                count(*) OVER() AS total
         FROM card c
         JOIN issuer i ON i.id = c.issuer_id
         JOIN card_offer co ON co.card_id = c.id
         WHERE ${where.join(' AND ')}
         ORDER BY c.name
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        params,
      ).then(r => r.rows),
    );

    const cards: CardSummary[] = rows.map((r) => ({
      id: r.id, slug: r.slug, name: r.name,
      issuerName: r.issuer_name, issuerSlug: r.issuer_slug,
      network: r.network, imageKey: r.image_key,
      newcomerEligible: r.newcomer_eligible, secured: r.secured,
      minCreditBand: r.min_credit_band, reviewSlug: r.review_slug,
      currentOffer: {
        id: r.offer_id,
        annualFeeCents: r.annual_fee_cents,
        purchaseAprBps: r.purchase_apr_bps,
        cashAdvanceAprBps: r.cash_advance_apr_bps,
        balanceTransferAprBps: r.balance_transfer_apr_bps,
        welcomeOfferText: r.welcome_offer_text,
        welcomeOfferValueCents: r.welcome_offer_value_cents,
        rewardsSummary: r.rewards_summary,
        fxFeeBps: r.fx_fee_bps,
        incomeRequirementCents: r.income_requirement_cents,
        verifiedAt: r.verified_at.toISOString(),
        sourceUrl: r.source_url,
      },
    }));

    return { mock: false, cards, total: rows[0] ? Number(rows[0].total) : 0 };
  }
}
