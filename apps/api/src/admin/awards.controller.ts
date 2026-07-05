import { BadRequestException, Body, Controller, Headers, Inject, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard.js';
import { DbService } from '../common/db.service.js';

/**
 * Awards + methodology admin — the Bill C-59 chain's write path.
 * Publishing order is enforced: methodology version first (approved), then
 * awards referencing it. The FK makes an unsubstantiated award unrepresentable;
 * these endpoints make the workflow explicit.
 */
@Controller('admin/awards')
@UseGuards(AdminGuard)
export class AdminAwardsController {
  constructor(@Inject(DbService) private db: DbService) {}

  @Post('methodology')
  async publishMethodology(
    @Headers('x-tenant') tenant = 'toprates',
    @Body() dto: { bodyMd: string; approvedBy: string },
  ) {
    if (!dto?.bodyMd || dto.bodyMd.length < 200)
      throw new BadRequestException('methodology must be substantive (>=200 chars) — it is the substantiation');
    if (!dto?.approvedBy) throw new BadRequestException('approvedBy required');
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');
    const row = await this.db.withTenant(tenantId, (c) =>
      c.query(
        `INSERT INTO methodology_version (tenant_id, body_md, published_at, approved_by)
         VALUES ($1, $2, now(), $3) RETURNING id`,
        [tenantId, dto.bodyMd, dto.approvedBy],
      ).then((r) => r.rows[0]));
    return { methodologyVersionId: row.id };
  }

  @Post()
  async createAward(
    @Headers('x-tenant') tenant = 'toprates',
    @Body() dto: { categorySlug: string; year: number; winnerCardId: string; rationaleMd: string; methodologyVersionId: string },
  ) {
    if (!dto?.methodologyVersionId)
      throw new BadRequestException('methodologyVersionId required — no methodology, no award');
    if (!dto?.rationaleMd || dto.rationaleMd.length < 50)
      throw new BadRequestException('rationale must be substantive');
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');
    const row = await this.db.withTenant(tenantId, async (c) => {
      const { rows: [m] } = await c.query(
        'SELECT published_at FROM methodology_version WHERE id = $1', [dto.methodologyVersionId]);
      if (!m?.published_at) throw new BadRequestException('methodology version not found or unpublished');
      const { rows: [a] } = await c.query(
        `INSERT INTO award (tenant_id, category_slug, year, winner_card_id, rationale_md, methodology_version_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, category_slug, year)
         DO UPDATE SET winner_card_id = EXCLUDED.winner_card_id,
                       rationale_md = EXCLUDED.rationale_md,
                       methodology_version_id = EXCLUDED.methodology_version_id
         RETURNING id`,
        [tenantId, dto.categorySlug, dto.year, dto.winnerCardId, dto.rationaleMd, dto.methodologyVersionId]);
      return a;
    });
    return { awardId: row.id };
  }
}
