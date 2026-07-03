import { Module } from '@nestjs/common';
import { DbService } from './common/db.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { RedirectController } from './redirect/redirect.controller.js';

@Module({
  controllers: [CatalogController, RedirectController],
  providers: [DbService],
})
export class AppModule {}
