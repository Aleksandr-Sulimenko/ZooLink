import { Module } from '@nestjs/common';
import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import { ListingModule } from '../listing/listing.module';

/**
 * Favorites domain (favorites-api.yaml v1.0.0 — Wave D / D11). Owner-scoped CRUD on the `favorites`
 * table; builds on the platform foundation (PrismaService, pagination util, IdempotencyInterceptor,
 * global auth/roles guards). No schema change — the table + UNIQUE(user_id, listing_id) + indexes and
 * the OfferingRef columns (migration 0032) already exist.
 *
 * Imports ListingModule to reuse ListingService.assertVisibleToActor — the SINGLE definition of listing
 * read-visibility (D10) — so a favorite can only reference a listing the actor may see. The import graph
 * stays acyclic: ListingModule (→ ModerationModule, AnimalModule) has no back-edge to FavoriteModule.
 */
@Module({
  imports: [ListingModule],
  controllers: [FavoriteController],
  providers: [FavoriteService],
  exports: [FavoriteService],
})
export class FavoriteModule {}
