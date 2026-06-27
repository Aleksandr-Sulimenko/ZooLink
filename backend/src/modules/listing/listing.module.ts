import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';

/**
 * Listing domain (marketplace, ADR-0002 market split). Slice 1: aggregate CRUD + photos + the
 * owner-side lifecycle to PENDING_MODERATION (create→DRAFT, /submit, soft-withdraw→DEACTIVATED) per
 * listings-api.yaml and listing_state_machine.md (invariants L-P0..L-15). Moderator-side transitions
 * (approve/reject), ACTIVE→SOLD/EXPIRED, payments, and geo-search are out of this slice.
 * Builds on the platform foundation — AuditLogService (agent-as-principal), PrismaService — and the
 * global auth guards.
 */
@Module({
  controllers: [ListingController],
  providers: [ListingService],
  exports: [ListingService],
})
export class ListingModule {}
