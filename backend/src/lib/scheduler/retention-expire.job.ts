import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import { AdvisoryLockKeys, AdvisoryLockService } from './advisory-lock';
import { RetentionService } from './retention.service';

/**
 * B7 scheduler + D2 behaviour (ADMIN_PHASE_ACTION_PLAN.md). The B7 form (cron + advisory-lock
 * wiring) now carries the D2 retention behaviour: per tick, under a single-instance advisory lock,
 * it (a) auto-expires ACTIVE listings past `expires_at` and (b) erases DEACTIVATED accounts past the
 * grace window. The work itself lives in RetentionService; this class only schedules it.
 *
 * Cron expression is configurable via RETENTION_TICK_CRON (default: hourly). Runs only in the worker
 * process (registered under SchedulerModule in WorkerModule), never in the HTTP API, and is disabled
 * in tests (cron side effects would make tests non-deterministic — tests call RetentionService directly).
 */
@Injectable()
export class RetentionExpireJob {
  private readonly logger = new Logger(RetentionExpireJob.name);

  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly config: AppConfigService,
    private readonly retention: RetentionService,
  ) {}

  @Cron(process.env.RETENTION_TICK_CRON ?? '0 * * * *', { name: 'retention-expire-tick' })
  async tick(): Promise<void> {
    if (this.config.isTest) return; // never fire cron side effects under test

    const ran = await this.locks.runExclusive(AdvisoryLockKeys.RETENTION_EXPIRE_TICK, async () => {
      const { expiredListings, erasedAccounts } = await this.retention.runOnce();
      this.logger.log(
        `retention/expire tick done — expired ${expiredListings} listing(s), erased ${erasedAccounts} account(s)`,
      );
    });

    if (!ran) {
      this.logger.debug('retention/expire tick skipped — advisory lock held by another instance');
    }
  }
}
