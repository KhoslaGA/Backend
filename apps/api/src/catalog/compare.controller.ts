import { Controller, Get, Headers, Inject, NotFoundException, Query } from '@nestjs/common';
import type { CardListResponse, CardSummary } from '@ratefamily/contracts';
import { CatalogController } from './catalog.controller.js';

@Controller('v1/cards/compare')
export class CompareController {
  constructor(@Inject(CatalogController) private catalog: CatalogController) {}

  /** GET /v1/cards/compare?ids=a,b,c — up to 3, order preserved */
  @Get()
  async compare(
    @Headers('x-tenant') tenant = 'toprates',
    @Query('ids') ids = '',
  ): Promise<{ mock: boolean; cards: CardSummary[] }> {
    const want = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    if (want.length < 2) throw new NotFoundException('provide 2-3 card ids');
    const list: CardListResponse = await this.catalog.list(tenant, undefined, undefined, undefined, '100', '0');
    const byId = new Map(list.cards.map((c) => [c.id, c]));
    const cards = want.map((id) => byId.get(id)).filter((c): c is CardSummary => !!c);
    if (cards.length !== want.length) throw new NotFoundException('one or more cards not found');
    return { mock: false, cards };
  }
}
