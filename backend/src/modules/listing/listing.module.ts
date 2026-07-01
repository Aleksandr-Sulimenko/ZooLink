import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { ModerationModule } from '../moderation/moderation.module';
import { AnimalModule } from '../animal/animal.module';

/**
 * Listing domain (marketplace, ADR-0002 market split). Slices: aggregate CRUD + photos + owner-side
 * lifecycle (Slice 1), geo/market search (Slice 2), and the Slice-4c owner-facing `lastModerationResult`
 * embed on GET /listings/{id} (reuses ModerationService.latestEffectiveResult — imports ModerationModule).
 * Per ADR-0018 it imports AnimalModule and routes all animal access + ownership checks through
 * AnimalService (no direct cross-aggregate reads of the `animals` table). AnimalModule has no back-edge
 * to ListingModule/ModerationModule, so the import graph is acyclic — no forwardRef needed.
 * Builds on the platform foundation — AuditLogService (agent-as-principal), PrismaService — and the
 * global auth guards.
 */
@Module({
  imports: [ModerationModule, AnimalModule],
  controllers: [ListingController],
  providers: [ListingService],
  exports: [ListingService],
})
export class ListingModule {}
