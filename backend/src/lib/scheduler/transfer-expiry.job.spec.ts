import { AdvisoryLockKeys, type AdvisoryLockService } from './advisory-lock';
import { TransferExpiryJob } from './transfer-expiry.job';
import type { TransferExpiryService } from './transfer-expiry.service';
import type { AppConfigService } from '../../config/app-config.service';

describe('TransferExpiryJob', () => {
  function make(opts: { isTest?: boolean; acquired?: boolean } = {}) {
    const runOnce = jest.fn().mockResolvedValue(0);
    const expiry = { runOnce } as unknown as TransferExpiryService;
    let lockedKey: bigint | undefined;
    const runExclusive = jest.fn(async (key: bigint, work: () => Promise<void>) => {
      lockedKey = key;
      if (opts.acquired === false) return false;
      await work();
      return true;
    });
    const locks = { runExclusive } as unknown as AdvisoryLockService;
    const config = { isTest: opts.isTest ?? false } as unknown as AppConfigService;
    const job = new TransferExpiryJob(locks, config, expiry);
    return { job, runOnce, runExclusive, getKey: () => lockedKey };
  }

  it('runs the expiry pass under the DISTINCT TRANSFER_EXPIRY_TICK advisory lock', async () => {
    const { job, runOnce, getKey } = make();
    await job.tick();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(getKey()).toBe(AdvisoryLockKeys.TRANSFER_EXPIRY_TICK);
    // A collision with either sibling job's key would let two ticks run concurrently.
    expect(AdvisoryLockKeys.TRANSFER_EXPIRY_TICK).not.toBe(AdvisoryLockKeys.MODERATION_ESCALATION_TICK);
    expect(AdvisoryLockKeys.TRANSFER_EXPIRY_TICK).not.toBe(AdvisoryLockKeys.RETENTION_EXPIRE_TICK);
  });

  it('skips the pass when the advisory lock is held by another instance (single-winner)', async () => {
    const { job, runOnce } = make({ acquired: false });
    await job.tick();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('never fires under test mode (no cron side effects)', async () => {
    const { job, runOnce, runExclusive } = make({ isTest: true });
    await job.tick();
    expect(runExclusive).not.toHaveBeenCalled();
    expect(runOnce).not.toHaveBeenCalled();
  });
});
