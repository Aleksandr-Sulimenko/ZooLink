import { Module } from '@nestjs/common';
import { ModerationController, OwnerModerationResultController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ContentReportController } from './content-report.controller';
import { ContentReportService } from './content-report.service';

/**
 * Moderation domain (Admin Slice 4a + 4b; ADR-0003 pre-moderation, ADR-0006/0011 agent-as-principal).
 * - 4a: operator queue + claim/lock + the one-transaction decision/transition/audit + append-only
 *   ledger + reasons/templates dictionaries + the owner-facing agent-transparency result.
 * - 4b: user content reports (file / role-scoped read / object-scoped get / MOD-resolve), reusing the
 *   server-derived-actor, listScope read-scope, dedup-23505→409, and guarded-conditional patterns.
 * Every actor-bearing write snapshots the acting principal and is agent-ready. Builds on the platform
 * foundation — AuditLogService, FeatureToggleService, PrismaService — and the global auth guards.
 * (M-14 re-moderation-on-edit remains a Slice-4b/listing-edit follow-up — see flag.)
 */
@Module({
  controllers: [ModerationController, OwnerModerationResultController, ContentReportController],
  providers: [ModerationService, ContentReportService],
  exports: [ModerationService, ContentReportService],
})
export class ModerationModule {}
