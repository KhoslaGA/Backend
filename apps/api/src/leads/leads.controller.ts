import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, NotFoundException, Post } from '@nestjs/common';
import { DbService } from '../common/db.service.js';

/**
 * Leads intake. Rules:
 *  - No lead without a consent record: the CASL wording shown is stored verbatim
 *    as evidence, in the same transaction.
 *  - Routing is deterministic by vertical + licensing posture:
 *      life           -> klc_life (licensed, live today)
 *      auto/home/comm -> nurture_pnc (renewal-month bank; no sales until RIBO P&C)
 *      travel/health  -> educational_only
 *  - renewal_month is the intent signal the launch plan banks on.
 */
const ROUTE: Record<string, string> = {
  life: 'klc_life', auto: 'nurture_pnc', home: 'nurture_pnc', commercial: 'nurture_pnc',
  travel: 'educational_only', health: 'educational_only', credit: 'educational_only',
};

@Controller('v1/leads')
export class LeadsController {
  constructor(@Inject(DbService) private db: DbService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Headers('x-tenant') tenant = 'toprates',
    @Body() dto: {
      vertical: string;
      contact: { name?: string; email?: string; phone?: string };
      renewalMonth?: number;
      consent: { wording: string; pageUrl?: string };
    },
  ) {
    if (!ROUTE[dto?.vertical]) throw new BadRequestException('unknown vertical');
    if (!dto?.contact?.email && !dto?.contact?.phone)
      throw new BadRequestException('contact requires email or phone');
    if (!dto?.consent?.wording || dto.consent.wording.length < 20)
      throw new BadRequestException('consent wording is required verbatim — no lead without CASL evidence');
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');

    return this.db.withTenant(tenantId, async (c) => {
      await c.query('BEGIN');
      try {
        const { rows: [consent] } = await c.query(
          `INSERT INTO consent_record (tenant_id, kind, wording, page_url)
           VALUES ($1, 'casl_express', $2, $3) RETURNING id`,
          [tenantId, dto.consent.wording, dto.consent.pageUrl ?? null]);
        const { rows: [lead] } = await c.query(
          `INSERT INTO lead (tenant_id, vertical, contact, renewal_month, consent_record_id, routed_to)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, routed_to`,
          [tenantId, dto.vertical, JSON.stringify(dto.contact),
           dto.renewalMonth ?? null, consent.id, ROUTE[dto.vertical]]);
        await c.query('COMMIT');
        return { leadId: lead.id, routedTo: lead.routed_to };
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }
}
