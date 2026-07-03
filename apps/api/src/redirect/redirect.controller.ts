import { Controller, Get, Headers, Inject, Logger, NotFoundException, Param, Query, Redirect, Req } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { DbService } from '../common/db.service.js';

/**
 * /go/:cardId — the only path affiliate URLs ever take.
 * 1. Resolve active affiliate_link (apply default, ?d=terms supported)
 * 2. Log click async — the redirect NEVER blocks on the write
 * 3. 302 with network subid = our click id (postback reconciliation key)
 * 4. Fallback: no active link -> issuer public page via terms link or card source; monetizable=false, still logged
 */
@Controller('go')
export class RedirectController {
  private log = new Logger('redirect');
  constructor(@Inject(DbService) private db: DbService) {}

  @Get(':cardId')
  @Redirect(undefined, 302)
  async go(
    @Param('cardId') cardId: string,
    @Headers('x-tenant') tenantSlug = 'toprates',
    @Req() req: Request,
    @Query('cta') cta = 'apply_now_button',
    @Query('sec') sec?: string,
    @Query('pos') pos?: string,
    @Query('pv') pv?: string,
    @Query('d') d: 'apply' | 'terms' = 'apply',
  ) {
    const tenantId = await this.db.tenantId(tenantSlug);
    if (!tenantId) throw new NotFoundException('unknown tenant');

    const row = await this.db.withTenant(tenantId, (c) =>
      c.query(
        `SELECT al.id AS link_id, al.url, al.tracking_template, al.network,
                c.id AS card_id
         FROM card c
         LEFT JOIN affiliate_link al
           ON al.card_id = c.id AND al.destination = $2 AND al.active
         WHERE c.id = $1 AND c.status = 'active'`,
        [cardId, d],
      ).then((r) => r.rows[0]),
    );
    if (!row) throw new NotFoundException('unknown card');

    const clickId = randomUUID();
    const monetizable = !!row.link_id;

    // destination: tracked affiliate URL, or honest fallback
    let url: string;
    if (monetizable) {
      url = row.url + (row.tracking_template ?? '').replace('{click_id}', clickId);
    } else {
      // fallback — issuer terms link if one exists, else the card's offer source page
      const fb = await this.db.withTenant(tenantId, (c) =>
        c.query(
          `SELECT COALESCE(
             (SELECT al.url FROM affiliate_link al WHERE al.card_id = $1 AND al.destination='terms' AND al.active LIMIT 1),
             (SELECT co.source_url FROM card_offer co WHERE co.card_id = $1 AND co.superseded_by IS NULL LIMIT 1)
           ) AS url`,
          [cardId],
        ).then((r) => r.rows[0]?.url),
      );
      if (!fb) throw new NotFoundException('no destination available');
      url = fb;
    }

    // fire-and-forget click log — errors logged, never surfaced to the user
    const ua = req.headers['user-agent'] ?? '';
    void this.db
      .withTenant(tenantId, (c) =>
        c.query(
          `INSERT INTO click
             (id, tenant_id, card_id, affiliate_link_id, cta_type,
              impression_section, impression_position, page_url, pageview_id,
              session_id, user_agent_hash, referrer, monetizable)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            clickId, tenantId, cardId, row.link_id ?? null, cta,
            sec ?? null, pos != null ? Number(pos) : null,
            (req.headers['referer'] as string) ?? null,
            pv ?? null,
            (req as any).cookies?.rf_sid ?? null,
            ua ? createHash('sha256').update(ua as string).digest('hex').slice(0, 32) : null,
            (req.headers['referer'] as string) ?? null,
            monetizable,
          ],
        ),
      )
      .catch((e) => this.log.error(`click log failed: ${e.message}`));

    return { url };
  }
}
