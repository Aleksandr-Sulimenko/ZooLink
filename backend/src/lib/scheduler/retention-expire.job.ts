import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import { AdvisoryLockKeys, AdvisoryLockService } from './advisory-lock';

/**
 * B7 scheduler SKELETON (ADMIN_PHASE_ACTION_PLAN.md). This is the FORM of a periodic job, not the
 * behaviour: it proves the cron + advisory-lock wiring works and gives D2 (auto-expire / retention)
 * a place to land with zero re-wiring. Today it only logs a heartbeat — it expires/retains nothing.
 *
 * Forward-compatibility: the actual expiry/retention pass goes inside the `runExclusive` callback
 * below when D2 opens; the single-instance guarantee and scheduling are already in place.
 *
 * Runs only in the worker process (registered under SchedulerModule in WorkerModule), never in the
 * HTTP API, and is disabled in tests (cron side effects would make tests non-deterministic).
 */
@Injectable()
export class RetentionExpireJob {
  private readonly logger = new Logger(RetentionExpireJob.name);

  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly config: AppConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'retention-expire-tick' })
  async tick(): Promise<void> {
    if (this.config.isTest) return; // never fire cron side effects under test

    const ran = await this.locks.runExclusive(AdvisoryLockKeys.RETENTION_EXPIRE_TICK, () => {
      // D2 placeholder — no behaviour yet. When auto-expire/retention lands, do the (async) work
      // here; it will already be single-instance-safe and scheduled.
      this.logger.log('retention/expire tick (skeleton, no-op) — lock held, nothing to do yet');
      return Promise.resolve();
    });

    if (!ran) {
      this.logger.debug('retention/expire tick skipped — advisory lock held by another instance');
    }
  }
}
