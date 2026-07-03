import { BadRequestException, Body, Controller, Headers, Inject, NotFoundException, Post } from '@nestjs/common';
import { DbService } from '../common/db.service.js';

/**
 * Admin write path for offers — the ONLY way offer data changes.
 * Append-only supersession in one transaction: insert new verified offer,
 * mark the previous current offer superseded_by it.
 *
 * NOTE: no auth yet — Clerk guard lands with the admin phase. Until then this
 * module must NOT be exposed publicly; it exists so the supersession flow and
 * its guarantees are built and tested now.
 */
interface NewOfferDto {
  cardId: string;
  annualFeeCents: number;
  purchaseAprBps: number;
  balanceTransferAprBps?: number | null;
  welcomeOfferText?: string | null;
  welcomeOfferValueCents?: number | null;
  rewardsSummary: Record<string, number>;
  fxFeeBps: number;
  incomeRequirementCents?: number | null;
  verifiedAt: string;   // ISO — human-verified date, required
  sourceUrl: string;    // issuer page — required
}

@Controller('admin/offers')
export class AdminOffersController {
  constructor(@Inject(DbService) private db: DbService) {}

  @Post()
  async supersede(
    @Headers('x-tenant') tenant = 'toprates',
    @Body() dto: NewOfferDto,
  ) {
    if (!dto?.verifiedAt || !dto?.sourceUrl)
      throw new BadRequestException('verified_at and source_url are required — unverified offers cannot exist');
    if (dto.sourceUrl.startsWith('DEV-FIXTURE'))
      throw new BadRequestException('DEV-FIXTURE sources are not valid verification');
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');

    return this.db.withTenant(tenantId, async (c) => {
      await c.query('BEGIN');
      try {
        const { rows: [prev] } = await c.query(
          'SELECT id FROM card_offer WHERE card_id = $1 AND superseded_by IS NULL FOR UPDATE',
          [dto.cardId]);
        const { rows: [next] } = await c.query(
          `INSERT INTO card_offer (tenant_id, card_id, annual_fee_cents, purchase_apr_bps,
             balance_transfer_apr_bps, welcome_offer_text, welcome_offer_value_cents,
             rewards_summary, fx_fee_bps, income_requirement_cents, verified_at, source_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [tenantId, dto.cardId, dto.annualFeeCents, dto.purchaseAprBps,
           dto.balanceTransferAprBps ?? null, dto.welcomeOfferText ?? null,
           dto.welcomeOfferValueCents ?? null, JSON.stringify(dto.rewardsSummary),
           dto.fxFeeBps, dto.incomeRequirementCents ?? null, dto.verifiedAt, dto.sourceUrl]);
        if (prev) await c.query('UPDATE card_offer SET superseded_by = $1 WHERE id = $2', [next.id, prev.id]);
        await c.query('COMMIT');
        return { offerId: next.id, supersededOfferId: prev?.id ?? null };
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }
}
