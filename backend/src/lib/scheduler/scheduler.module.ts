import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../db/db.module';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AdvisoryLockService } from './advisory-lock';
import { RetentionExpireJob } from './retention-expire.job';
import { RetentionService } from './retention.service';
import { ModerationEscalationJob } from './moderation-escalation.job';
import { ModerationEscalationService } from './moderation-escalation.service';

/**
 * Periodic-job host (B7 scheduler form). Registered in the WORKER context only — the HTTP API must
 * not run cron. `ScheduleModule.forRoot()` boots the cron registry; jobs coordinate single-instance
 * execution across a future scaled-out fleet via PG advisory locks (AdvisoryLockService).
 *
 * Jobs: RetentionExpireJob (D2) + ModerationEscalationJob (Slice 4c — Moderation.Escalated emission).
 * Adding a job: provide it here + give it a fresh AdvisoryLockKeys constant. Do NOT register this
 * module in AppModule (API) — that would double-fire every tick. OutboxModule is @Global, but imported
 * explicitly for clarity (the escalation service publishes via OutboxService).
 */
@Module({
  imports: [ScheduleModule.forRoot(), DbModule, AuditModule, OutboxModule],
  providers: [
    AdvisoryLockService,
    RetentionExpireJob,
    RetentionService,
    ModerationEscalationJob,
    ModerationEscalationService,
  ],
  exports: [AdvisoryLockService, RetentionService, ModerationEscalationService],
})
export class SchedulerModule {}
