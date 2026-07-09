import { CapabilityProfileService } from './capability-profile.service';
import type { PrismaService } from '../../lib/db/prisma.service';

function makeService(findUnique: jest.Mock): CapabilityProfileService {
  const prisma = { agent_capability_profiles: { findUnique } } as unknown as PrismaService;
  return new CapabilityProfileService(prisma);
}

describe('CapabilityProfileService.resolveScope (ADR-0037 deny-by-default)', () => {
  const VALID_SCOPE = [
    { action: 'read', subject: 'ModerationQueue' },
    { action: 'create', subject: 'ModerationDecision' },
  ];

  it('returns undefined for a null profile id (no profile → deny-by-default)', async () => {
    const svc = makeService(jest.fn());
    expect(await svc.resolveScope(null)).toBeUndefined();
  });

  it('resolves an active profile to its scope', async () => {
    const svc = makeService(jest.fn().mockResolvedValue({ id: 1, is_active: true, scope: VALID_SCOPE }));
    expect(await svc.resolveScope(1)).toEqual(VALID_SCOPE);
  });

  it('returns undefined for a missing profile', async () => {
    const svc = makeService(jest.fn().mockResolvedValue(null));
    expect(await svc.resolveScope(42)).toBeUndefined();
  });

  it('returns undefined for an inactive profile', async () => {
    const svc = makeService(jest.fn().mockResolvedValue({ id: 1, is_active: false, scope: VALID_SCOPE }));
    expect(await svc.resolveScope(1)).toBeUndefined();
  });

  it('drops a wildcard grant stored in the profile (defense-in-depth)', async () => {
    const svc = makeService(
      jest.fn().mockResolvedValue({
        id: 1,
        is_active: true,
        scope: [{ action: 'manage', subject: 'all' }, { action: 'read', subject: 'Listing' }],
      }),
    );
    expect(await svc.resolveScope(1)).toEqual([{ action: 'read', subject: 'Listing' }]);
  });

  it('returns undefined when the stored scope is empty/malformed', async () => {
    const svc = makeService(jest.fn().mockResolvedValue({ id: 1, is_active: true, scope: [] }));
    expect(await svc.resolveScope(1)).toBeUndefined();
  });

  it('validate() rejects a scope containing manage/all', () => {
    const svc = makeService(jest.fn());
    expect(() => svc.validate([{ action: 'manage', subject: 'Listing' }])).toThrow();
    expect(() => svc.validate(VALID_SCOPE)).not.toThrow();
  });
});
