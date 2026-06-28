import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import { AdvisoryLockKeys, AdvisoryLockService } from './advisory-lock';
import { ModerationEscalationService } from './moderation-escalation.service';

/**
 * Slice 4c (A) SLA-escalation scheduler. Mirrors RetentionExpireJob: a `@Cron` tick that runs the
 * escalation pass under a single-instance advisory lock (MODERATION_ESCALATION_TICK, distinct from the
 * retention key) so a future scaled-out worker fleet emits `Moderation.Escalated` at most once per item.
 *
 * Worker context only (registered under SchedulerModule in WorkerModule), never the HTTP API, and
 * disabled under test (cron side effects would make tests non-deterministic — tests call
 * ModerationEscalationService.runOnce directly). Cron is configurable via MODERATION_ESCALATION_TICK_CRON.
 */
@Injectable()
export class ModerationEscalationJob {
  private readonly logger = new Logger(ModerationEscalationJob.name);

  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly config: AppConfigService,
    private readonly escalation: ModerationEscalationService,
  ) {}

  @Cron(process.env.MODERATION_ESCALATION_TICK_CRON ?? '*/15 * * * *', { name: 'moderation-escalation-tick' })
  async tick(): Promise<void> {
    if (this.config.isTest) return; // never fire cron side effects under test

    const ran = await this.locks.runExclusive(AdvisoryLockKeys.MODERATION_ESCALATION_TICK, async () => {
      const escalated = await this.escalation.runOnce();
      this.logger.log(`moderation/escalation tick done — escalated ${escalated} item(s)`);
    });

    if (!ran) {
      this.logger.debug('moderation/escalation tick skipped — advisory lock held by another instance');
    }
  }
}
