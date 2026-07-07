import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

/**
 * The minimal actor shape the read-scope gate needs (a structural subset of `AuthPrincipal`, kept
 * local so `lib/org` does not depend on `lib/auth`). `undefined`/`null` = an anonymous reader.
 */
export interface ReadScopeActor {
  userId: string;
  role: string;
}

/** The owning-party pointer of a read target: its principal owner id + owning-org id (either may be null). */
export interface ReadScopeTarget {
  ownerId: string | null | undefined;
  organizationId: string | null | undefined;
}

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

  /**
   * The canonical object-level "acts as owner" predicate: true when `userId` is the row's own
   * principal (`principalId` — an animal's `owner_id`, a listing's `seller_id`, or a transfer
   * party) OR an ACTIVE OWNER of the row's `organizationId`. This is the single source of the
   * `X === actor.userId || (org && isOrgAdmin(actor, org))` idiom that was copy-pasted across the
   * animal / listing / moderation / transfer services (ADR-0018 §Amendment D4, dedup — security
   * AUDIT3 FC-1: "copy-pasted authz, one WILL get it wrong"). Operator-scope shortcuts (ADMIN /
   * MODERATOR) stay at the call site because they vary per surface; the party/org-admin core is
   * here, defined once. Agent-as-principal (ADR-0006): keyed on `userId`, so an AGENT principal
   * resolves identically — no human assumption.
   */
  async isPartyOrOrgAdmin(
    userId: string,
    principalId: string | null | undefined,
    organizationId: string | null | undefined,
  ): Promise<boolean> {
    if (principalId && principalId === userId) return true;
    if (organizationId && (await this.isOrgAdmin(userId, organizationId))) return true;
    return false;
  }

  /**
   * The object-level READ-visibility predicate — the read-scope counterpart of {@link isPartyOrOrgAdmin}
   * (which is the *mutate* predicate, D4). An object is visible to `actor` when:
   *   - the actor is the target's party or an ACTIVE org-admin of its owning org (`isPartyOrOrgAdmin`), OR
   *   - `operatorRead` (default true) and the actor is a `MODERATOR`/`ADMIN` operator.
   * An anonymous reader (`actor` null/undefined) is never visible. This is the single definition of the
   * `anonymous→false; operator→true; else party-or-org-admin` idiom that was copy-pasted as
   * `listing.canSeeNonActive`, `moderation.getOwnerResult`'s `isOperator||isOwner`, and
   * `content-report.getById`'s `isOperator||reporter===actor` (security AUDIT3 FC-1: each new offering
   * object re-derived read-scope by hand and one WILL diverge — animal already did). Pass
   * `operatorRead:false` for a surface with NO operator widening (e.g. an owner-only saved query).
   * Agent-as-principal (ADR-0006): keyed on `userId`/`role`, so an AGENT principal resolves identically.
   */
  async isVisibleToActor(
    actor: ReadScopeActor | null | undefined,
    target: ReadScopeTarget,
    opts: { operatorRead?: boolean } = {},
  ): Promise<boolean> {
    if (!actor) return false;
    const operatorRead = opts.operatorRead ?? true;
    if (operatorRead && (actor.role === 'MODERATOR' || actor.role === 'ADMIN')) return true;
    return this.isPartyOrOrgAdmin(actor.userId, target.ownerId, target.organizationId);
  }

  /**
   * The shared 404-no-leak READ gate the audit (AUDIT3 FC-1) asked for as the DEFAULT for every
   * offering object: assert `actor` may read `target`, else throw a **byte-identical** `NotFoundException`
   * — never a 403 — so the endpoint cannot be used as an existence oracle over ids. Callers pass the
   * exact `{message, code}` their contract specifies (kept at the call site so each surface's error body
   * is unchanged). A surface that intentionally diverges (e.g. moderation's M-12 403) uses
   * {@link isVisibleToActor} directly and throws its own status.
   */
  async assertCanReadOrNotFound(
    actor: ReadScopeActor | null | undefined,
    target: ReadScopeTarget,
    notFound: { message: string; code: string },
    opts: { operatorRead?: boolean } = {},
  ): Promise<void> {
    if (!(await this.isVisibleToActor(actor, target, opts))) {
      throw new NotFoundException(notFound);
    }
  }

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

  /**
   * The user ids of every ACTIVE OWNER (org-admin) of `organizationId` — the inverse of
   * {@link isOrgAdmin}. Used by the notification consumer to fan an org-directed transactional
   * notification out to the org's admins (recipient resolution via the org aggregate's own service,
   * ADR-0018 — never a raw cross-aggregate join in the consumer).
   */
  async orgAdminUserIds(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.organization_users.findMany({
      where: { organization_id: organizationId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { user_id: true },
    });
    return rows.map((r) => r.user_id);
  }
}
