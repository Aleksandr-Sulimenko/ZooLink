import { OrgMembershipService } from './org-membership.service';
import type { PrismaService } from '../db/prisma.service';

/**
 * Direct coverage for the shared org-admin authorization primitive. It was extracted from four domain
 * services (animal / transfer / listing / moderation), all of which MOCK it — so its own discriminating
 * WHERE-clause (role_in_org = 'OWNER' AND status = 'ACTIVE') had no direct test. This is object-level
 * org-scope authz, so its negatives (a non-OWNER member, a non-ACTIVE owner) matter for access control.
 */

const USER = 'user-1';
const ORG = 'org-1';

function makeSvc(findFirst: jest.Mock, findMany: jest.Mock): OrgMembershipService {
  const prisma = { organization_users: { findFirst, findMany } } as unknown as PrismaService;
  return new OrgMembershipService(prisma);
}

describe('OrgMembershipService.isOrgAdmin', () => {
  it('returns true only for an ACTIVE OWNER membership', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'm1' });
    const svc = makeSvc(findFirst, jest.fn());
    await expect(svc.isOrgAdmin(USER, ORG)).resolves.toBe(true);
    // The discriminating guard is enforced in the query, not app-side.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: USER,
          organization_id: ORG,
          role_in_org: 'OWNER',
          status: 'ACTIVE',
        }),
      }),
    );
  });

  it('returns false when no ACTIVE OWNER membership exists (non-owner / suspended / absent)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const svc = makeSvc(findFirst, jest.fn());
    await expect(svc.isOrgAdmin(USER, ORG)).resolves.toBe(false);
  });
});

describe('OrgMembershipService.orgAdminIds', () => {
  it('returns only the orgs where the user is an ACTIVE OWNER', async () => {
    const findMany = jest.fn().mockResolvedValue([{ organization_id: 'a' }, { organization_id: 'b' }]);
    const svc = makeSvc(jest.fn(), findMany);
    await expect(svc.orgAdminIds(USER)).resolves.toEqual(['a', 'b']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: USER, role_in_org: 'OWNER', status: 'ACTIVE' }),
      }),
    );
  });

  it('returns an empty list when the user admins no org', async () => {
    const svc = makeSvc(jest.fn(), jest.fn().mockResolvedValue([]));
    await expect(svc.orgAdminIds(USER)).resolves.toEqual([]);
  });
});

describe('OrgMembershipService.isPartyOrOrgAdmin (D4 — consolidated owner/party predicate)', () => {
  it('is true when the user IS the row principal — WITHOUT hitting the DB (party short-circuit)', async () => {
    const findFirst = jest.fn();
    const svc = makeSvc(findFirst, jest.fn());
    await expect(svc.isPartyOrOrgAdmin(USER, USER, null)).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled(); // no org lookup when the party already matches
  });

  it('is true when the user is an ACTIVE OWNER of the row org', async () => {
    const svc = makeSvc(jest.fn().mockResolvedValue({ id: 'm1' }), jest.fn());
    await expect(svc.isPartyOrOrgAdmin(USER, 'someone-else', ORG)).resolves.toBe(true);
  });

  it('is false for a non-party, non-org-admin actor (404-no-leak floor)', async () => {
    const svc = makeSvc(jest.fn().mockResolvedValue(null), jest.fn());
    await expect(svc.isPartyOrOrgAdmin(USER, 'someone-else', ORG)).resolves.toBe(false);
  });

  it('is false when there is neither a party match nor an org to check', async () => {
    const findFirst = jest.fn();
    const svc = makeSvc(findFirst, jest.fn());
    await expect(svc.isPartyOrOrgAdmin(USER, null, null)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
