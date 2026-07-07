import { NotFoundException } from '@nestjs/common';
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

/**
 * D10 — the shared object-level READ-scope gate (the read counterpart of isPartyOrOrgAdmin). This is the
 * single definition of "owner OR org-admin OR operator → visible; else 404-no-leak" that listing /
 * moderation-owner-result / content-report read paths delegate to. Every branch is pinned here so a
 * future offering object inherits proven behaviour instead of re-deriving it (AUDIT3 FC-1).
 */
describe('OrgMembershipService.isVisibleToActor (D10 — shared read-scope)', () => {
  const target = { ownerId: 'owner-x', organizationId: ORG };

  it('anonymous (no actor) is never visible — WITHOUT hitting the DB', async () => {
    const findFirst = jest.fn();
    const svc = makeSvc(findFirst, jest.fn());
    await expect(svc.isVisibleToActor(undefined, target)).resolves.toBe(false);
    await expect(svc.isVisibleToActor(null, target)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('the owning party is visible (party short-circuit, no DB)', async () => {
    const findFirst = jest.fn();
    const svc = makeSvc(findFirst, jest.fn());
    await expect(
      svc.isVisibleToActor({ userId: 'owner-x', role: 'USER' }, target),
    ).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('an org-admin of the owning org is visible', async () => {
    const svc = makeSvc(jest.fn().mockResolvedValue({ id: 'm1' }), jest.fn());
    await expect(
      svc.isVisibleToActor({ userId: 'stranger', role: 'USER' }, target),
    ).resolves.toBe(true);
  });

  it.each(['MODERATOR', 'ADMIN'])('a %s operator is visible without a party/org match (no DB)', async (role) => {
    const findFirst = jest.fn();
    const svc = makeSvc(findFirst, jest.fn());
    await expect(svc.isVisibleToActor({ userId: 'stranger', role }, target)).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('a stranger (non-party, non-org-admin, non-operator) is NOT visible', async () => {
    const svc = makeSvc(jest.fn().mockResolvedValue(null), jest.fn());
    await expect(
      svc.isVisibleToActor({ userId: 'stranger', role: 'USER' }, target),
    ).resolves.toBe(false);
  });

  it('operatorRead:false suppresses the operator widening (owner-only surface, e.g. SS-1)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const svc = makeSvc(findFirst, jest.fn());
    // A MODERATOR with no party/org match is NOT visible when operator widening is off.
    await expect(
      svc.isVisibleToActor({ userId: 'stranger', role: 'MODERATOR' }, target, { operatorRead: false }),
    ).resolves.toBe(false);
    // The owner is still visible.
    await expect(
      svc.isVisibleToActor({ userId: 'owner-x', role: 'USER' }, target, { operatorRead: false }),
    ).resolves.toBe(true);
  });
});

describe('OrgMembershipService.assertCanReadOrNotFound (D10 — 404-no-leak gate)', () => {
  const target = { ownerId: 'owner-x', organizationId: ORG };
  const notFound = { message: 'X not found', code: 'NOT_FOUND' };

  it('is a no-op (resolves) when the actor may read', async () => {
    const svc = makeSvc(jest.fn(), jest.fn());
    await expect(
      svc.assertCanReadOrNotFound({ userId: 'owner-x', role: 'USER' }, target, notFound),
    ).resolves.toBeUndefined();
  });

  it('throws a byte-identical NotFoundException (never 403) for a stranger — existence oracle closed', async () => {
    const svc = makeSvc(jest.fn().mockResolvedValue(null), jest.fn());
    await expect(
      svc.assertCanReadOrNotFound({ userId: 'stranger', role: 'USER' }, target, notFound),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws the same NotFoundException for an anonymous reader', async () => {
    const svc = makeSvc(jest.fn(), jest.fn());
    await expect(svc.assertCanReadOrNotFound(undefined, target, notFound)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
