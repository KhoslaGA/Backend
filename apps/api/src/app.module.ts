import { Module } from '@nestjs/common';
import { DbService } from './common/db.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { CompareController } from './catalog/compare.controller.js';
import { RedirectController } from './redirect/redirect.controller.js';
import { MatchController } from './match/match.controller.js';
import { EventsController } from './events/events.controller.js';
import { AdminOffersController } from './admin/offers.controller.js';
import { AdminGuard } from './common/admin.guard.js';

@Module({
  // CompareController before CatalogController: /v1/cards/compare must not be
  // swallowed by /v1/cards route matching order
  controllers: [CompareController, CatalogController, RedirectController,
                MatchController, EventsController, AdminOffersController],
  providers: [DbService, CatalogController, AdminGuard],
})
export class AppModule {}
