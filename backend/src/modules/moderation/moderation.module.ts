import { Module } from '@nestjs/common';
import { ModerationController, OwnerModerationResultController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/**
 * Moderation domain (Admin Slice 4a; ADR-0003 pre-moderation, ADR-0006/0011 agent-as-principal).
 * Operator queue + claim/lock + the one-transaction decision/transition/audit + append-only ledger +
 * reasons/templates dictionaries + the owner-facing agent-transparency result. Every decision snapshots
 * the acting principal and is agent-ready (AGENT decisioning gated by `agent_moderation`, off in MVP).
 * Builds on the platform foundation — AuditLogService, FeatureToggleService, PrismaService — and the
 * global auth guards. Content-reports + M-14 re-moderation-on-edit are out of 4a (see flags).
 */
@Module({
  controllers: [ModerationController, OwnerModerationResultController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
