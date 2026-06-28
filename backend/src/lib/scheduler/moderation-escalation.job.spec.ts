import { AdvisoryLockKeys, type AdvisoryLockService } from './advisory-lock';
import { ModerationEscalationJob } from './moderation-escalation.job';
import type { ModerationEscalationService } from './moderation-escalation.service';
import type { AppConfigService } from '../../config/app-config.service';

describe('ModerationEscalationJob', () => {
  function make(opts: { isTest?: boolean; acquired?: boolean } = {}) {
    const runOnce = jest.fn().mockResolvedValue(0);
    const escalation = { runOnce } as unknown as ModerationEscalationService;
    let lockedKey: bigint | undefined;
    const runExclusive = jest.fn(async (key: bigint, work: () => Promise<void>) => {
      lockedKey = key;
      if (opts.acquired === false) return false;
      await work();
      return true;
    });
    const locks = { runExclusive } as unknown as AdvisoryLockService;
    const config = { isTest: opts.isTest ?? false } as unknown as AppConfigService;
    const job = new ModerationEscalationJob(locks, config, escalation);
    return { job, runOnce, runExclusive, getKey: () => lockedKey };
  }

  it('SLA-2: runs the escalation pass under the DISTINCT MODERATION_ESCALATION_TICK advisory lock', async () => {
    const { job, runOnce, getKey } = make();
    await job.tick();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(getKey()).toBe(AdvisoryLockKeys.MODERATION_ESCALATION_TICK);
    expect(AdvisoryLockKeys.MODERATION_ESCALATION_TICK).not.toBe(AdvisoryLockKeys.RETENTION_EXPIRE_TICK);
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
