import { BadRequestException, Body, Controller, Headers, Inject, NotFoundException, Post, ServiceUnavailableException } from '@nestjs/common';
import type { AutoQuoteRequest } from '@ratefamily/contracts';
import { DbService } from '../common/db.service.js';
import { CarrierAdapter, MockCarrierAdapter } from './carrier.adapter.js';

/**
 * Quotes API. Rules:
 *  - Commerce gate is per-vertical-per-tenant, read from env for now
 *    (QUOTES_<VERTICAL>_STATE = live | educational | coming-soon); the frontend
 *    3-state gate mirrors this. A vertical not 'live' returns 409-style guidance,
 *    never a silent quote.
 *  - Panel passthrough: the adapter result is returned untouched — every carrier
 *    result incl. declines reaches the caller (TAC).
 *  - Every quote is logged (no PII in the profile by contract — FSA not full
 *    postal, no names) for the proprietary dataset from day one.
 *  - bind endpoint DOES NOT EXIST in this codebase. Nothing to flag off.
 */
@Controller('v1/quotes')
export class QuotesController {
  private adapter: CarrierAdapter = new MockCarrierAdapter();
  constructor(@Inject(DbService) private db: DbService) {}

  private gate(vertical: string): 'live' | 'educational' | 'coming-soon' {
    const v = process.env[`QUOTES_${vertical.toUpperCase()}_STATE`];
    return v === 'live' || v === 'educational' ? v : 'coming-soon';
  }

  @Post('auto')
  async auto(
    @Headers('x-tenant') tenant = 'toprates',
    @Headers('x-mock-scenario') scenario: string | undefined,
    @Body() req: AutoQuoteRequest,
  ) {
    const state = this.gate('auto');
    if (state !== 'live' && process.env.QUOTES_ALLOW_PREVIEW !== 'true')
      return { state, quote: null, message: 'Auto quotes are not yet available — join the waitlist and we will contact you near your renewal.' };
    if (!req?.personaId && (!req?.driver || !req?.vehicle))
      throw new BadRequestException('driver and vehicle required (or personaId in dev)');
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');

    let result: any;
    try {
      result = await this.adapter.quoteAuto(req, scenario);
    } catch (e: any) {
      throw new ServiceUnavailableException(`rating unavailable: ${e.message}`);
    }
    // proprietary dataset from day one — quoteId + shape only, no PII
    void this.db.withTenant(tenantId, (c) =>
      c.query(
        `INSERT INTO quote_log (tenant_id, vertical, source, quote_ref, panel_size, declined_count)
         VALUES ($1,'auto',$2,$3,$4,$5)`,
        [tenantId, this.adapter.source, result?.quoteId ?? null,
         result?.results?.length ?? 0,
         (result?.results ?? []).filter((r: any) => r.declined).length]),
    ).catch(() => {});
    return { state, quote: result };
  }

  @Post('life')
  async life(
    @Headers('x-tenant') tenant = 'toprates',
    @Body() req: Record<string, unknown>,
  ) {
    const state = this.gate('life');
    if (state !== 'live' && process.env.QUOTES_ALLOW_PREVIEW !== 'true')
      return { state, quote: null, message: 'Life quotes are available through a licensed KLC advisor — request a callback.' };
    const tenantId = await this.db.tenantId(tenant);
    if (!tenantId) throw new NotFoundException('unknown tenant');
    let result: any;
    try {
      result = await this.adapter.quoteLife(req);
    } catch (e: any) {
      throw new ServiceUnavailableException(`rating unavailable: ${e.message}`);
    }
    void this.db.withTenant(tenantId, (c) =>
      c.query(
        `INSERT INTO quote_log (tenant_id, vertical, source, quote_ref, panel_size, declined_count)
         VALUES ($1,'life',$2,$3,$4,$5)`,
        [tenantId, this.adapter.source, result?.quoteId ?? null, result?.results?.length ?? 0, 0]),
    ).catch(() => {});
    return { state, quote: result };
  }
}
