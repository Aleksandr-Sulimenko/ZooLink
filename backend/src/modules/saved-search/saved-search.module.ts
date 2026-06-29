import { Module } from '@nestjs/common';
import { SavedSearchController } from './saved-search.controller';
import { SavedSearchService } from './saved-search.service';

/**
 * Saved-search domain (geo-search-api.yaml `/saved-searches`, spec 07 round-5 SS-1..SS-6 — Listings
 * Slice 3). Plain owner-scoped CRUD on `saved_searches`; builds on the platform foundation (PrismaService,
 * pagination util, IdempotencyInterceptor, global auth/roles guards). No schema change (the table +
 * idx_saved_searches_user + chk_saved_searches_latlng already exist).
 */
@Module({
  controllers: [SavedSearchController],
  providers: [SavedSearchService],
  exports: [SavedSearchService],
})
export class SavedSearchModule {}
