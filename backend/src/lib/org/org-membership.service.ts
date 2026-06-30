import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

/**
 * Shared organization-membership lookups. Extracted (audit 2026-06-30 MAJOR) from the four domain
 * services (animal / transfer / listing / moderation) that each carried an identical `isOrgAdmin` /
 * `orgAdminIds` copy. One canonical definition of "org admin" — an `OWNER` membership in `ACTIVE`
 * status (the four-canon `role_in_org`, ADR-0011 A2) — used uniformly for object-level org-scope
 * authorization (404-no-leak own-scope AND-intersect).
 *
 * Agent-as-principal (ADR-0006): the membership is keyed on `user_id` (the acting account), so an
 * AGENT principal that owns an org membership resolves identically — no human assumption.
 */
@Injectable()
export class OrgMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  /** True when `userId` is an ACTIVE OWNER of `organizationId` (the org-admin scope). */
  async isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.prisma.organization_users.findFirst({
      where: { user_id: userId, organization_id: organizationId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    return membership !== null;
  }

  /** The ids of every organization `userId` is an ACTIVE OWNER of (for org-scoped list filters). */
  async orgAdminIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.organization_users.findMany({
      where: { user_id: userId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { organization_id: true },
    });
    return rows.map((r) => r.organization_id);
  }
}
