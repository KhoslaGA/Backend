import { Body, Controller, Headers, HttpCode, Inject, NotFoundException, Post } from '@nestjs/common';
import type { ImpressionBatch } from '@ratefamily/contracts';
import { DbService } from '../common/db.service.js';

@Controller('v1/events')
export class EventsController {
  constructor(@Inject(DbService) private db: DbService) {}

  /** Batched impression ingestion — single multi-row INSERT, capped at 100/batch. */
  @Post('impressions')
  @HttpCode(202)
  async impressions(
    @Headers('x-tenant') tenant = 'toprates',
    @Body() batch: ImpressionBatch,
  ): Promise<{ accepted: number }> {
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');
    const events = (batch?.events ?? []).slice(0, 100);
    if (!events.length) return { accepted: 0 };
    const vals: unknown[] = [];
    const rows = events.map((e, i) => {
      vals.push(tenantId, e.pageviewId, e.cardId, e.section, e.position, e.pageUrl);
      const b = i * 6;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
    });
    await this.db.withTenant(tenantId, (c) =>
      c.query(
        `INSERT INTO impression (tenant_id, pageview_id, card_id, section, position, page_url)
         VALUES ${rows.join(',')}`, vals));
    return { accepted: events.length };
  }
}
