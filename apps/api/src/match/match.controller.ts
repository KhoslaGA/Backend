import { Body, Controller, Headers, Inject, NotFoundException, Post } from '@nestjs/common';
import type { CardListResponse } from '@ratefamily/contracts';
import { DbService } from '../common/db.service.js';
import { CatalogController } from '../catalog/catalog.controller.js';
import { match, type MatchProfile, type MatchResult } from './engine.js';

interface MatchResponse { mock: boolean; results: Array<Omit<MatchResult, 'card'> & { card: MatchResult['card'] }>; }

@Controller('v1/match')
export class MatchController {
  constructor(
    @Inject(DbService) private db: DbService,
    @Inject(CatalogController) private catalog: CatalogController,
  ) {}

  @Post()
  async run(
    @Headers('x-tenant') tenant = 'toprates',
    @Body() profile: MatchProfile,
  ): Promise<MatchResponse> {
    // basic input guard — full class-validator DTOs come with Clerk/admin phase
    const goals = ['cashback','travel','build_credit','low_interest','newcomer'];
    if (!profile || !goals.includes(profile.goal)) throw new NotFoundException('invalid profile');
    const list: CardListResponse = await this.catalog.list(tenant, undefined, undefined, undefined, '100', '0');
    return { mock: false, results: match(list.cards, profile, 5) };
  }
}
