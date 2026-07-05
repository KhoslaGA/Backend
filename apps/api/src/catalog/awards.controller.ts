import { Controller, Get, Headers, Inject, NotFoundException, Query } from '@nestjs/common';
import { DbService } from '../common/db.service.js';

/** Public read: awards for a year, each with its methodology — the page renders both or neither. */
@Controller('v1/awards')
export class AwardsController {
  constructor(@Inject(DbService) private db: DbService) {}

  @Get()
  async list(@Headers('x-tenant') tenant = 'toprates', @Query('year') year = '2026') {
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');
    const rows = await this.db.withTenant(tenantId, (c) =>
      c.query(
        `SELECT a.category_slug, a.year, a.rationale_md, a.methodology_version_id,
                c.slug AS winner_slug, c.name AS winner_name,
                m.body_md AS methodology_md, m.published_at AS methodology_published_at
         FROM award a
         JOIN card c ON c.id = a.winner_card_id
         JOIN methodology_version m ON m.id = a.methodology_version_id
         WHERE a.year = $1 ORDER BY a.category_slug`,
        [Number(year)],
      ).then((r) => r.rows));
    return { mock: false, awards: rows };
  }
}
