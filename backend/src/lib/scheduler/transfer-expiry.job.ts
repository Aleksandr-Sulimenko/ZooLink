import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import { AdvisoryLockKeys, AdvisoryLockService } from './advisory-lock';
import { TransferExpiryService } from './transfer-expiry.service';

/**
 * P2-6 (AUDIT4) ownership-transfer 72h-expiry scheduler. Mirrors ModerationEscalationJob /
 * RetentionExpireJob: a `@Cron` tick that runs the expiry pass under a single-instance advisory lock
 * (TRANSFER_EXPIRY_TICK — distinct key) so a future scaled-out worker fleet expires each transfer and
 * emits `OwnershipTransfer.Expired` at most once. The lock is the P2-2-fixed transaction-scoped lock.
 *
 * Worker context only (registered under SchedulerModule in WorkerModule), never the HTTP API, and
 * disabled under test (cron side effects would make tests non-deterministic — tests call
 * TransferExpiryService.runOnce directly). Cron is configurable via TRANSFER_EXPIRY_TICK_CRON (default
 * hourly — the window is 72h, so hourly precision is ample and light).
 */
@Injectable()
export class TransferExpiryJob {
  private readonly logger = new Logger(TransferExpiryJob.name);

  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly config: AppConfigService,
    private readonly expiry: TransferExpiryService,
  ) {}

  @Cron(process.env.TRANSFER_EXPIRY_TICK_CRON ?? '0 * * * *', { name: 'transfer-expiry-tick' })
  async tick(): Promise<void> {
    if (this.config.isTest) return; // never fire cron side effects under test

    const ran = await this.locks.runExclusive(AdvisoryLockKeys.TRANSFER_EXPIRY_TICK, async () => {
      const expired = await this.expiry.runOnce();
      this.logger.log(`transfer/expiry tick done — expired ${expired} transfer(s)`);
    });

    if (!ran) {
      this.logger.debug('transfer/expiry tick skipped — advisory lock held by another instance');
    }
  }
}
