import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
  type RawRuleOf,
} from '@casl/ability';
import type { AuthPrincipal } from './principal';
import type { ScopeGrant } from './scope';

/** CRUD + the catch-all `manage`. */
export type Action = 'manage' | 'create' | 'read' | 'update' | 'delete';

/** Authorization subjects (string-based; domain entities tag instances via casl `subject()`). */
export type Subject =
  | 'User'
  | 'Animal'
  | 'Listing'
  | 'ModerationDecision'
  | 'ModerationQueue'
  | 'ContentReport'
  | 'Organization'
  | 'Branch'
  | 'ReferenceData'
  | 'FeatureToggle'
  | 'NotificationTemplate'
  | 'Notification'
  | 'Favorite'
  | 'SavedSearch'
  | 'AuditLog'
  | 'Payment'
  | 'DigitalAsset'
  | 'all';

/** Subject as a bare type name (rule definition) or a tagged instance via casl `subject()`. */
export type AppSubject = Subject | ForcedSubject<Exclude<Subject, 'all'>>;
export type AppAbility = MongoAbility<[Action, AppSubject]>;

/**
 * Builds a CASL ability per principal from `rbac-matrix.md` (default-deny). This is the coarse +
 * ownership-conditioned layer; ownership conditions (e.g. `{ owner_id: userId }`) are checked at
 * the service layer by passing the loaded row via casl `subject()`. Per-domain rules refine this
 * map as each domain lands in Phase 2.
 *
 * ADR-0037 — an AGENT principal is NOT granted its role's full authority. For an AGENT the effective
 * ability = `matrix(role) ∩ scope`, deny-by-default, and the `manage:all` wildcard is NEVER emitted
 * (it lives only in the HUMAN `ADMIN` branch below). The HUMAN path is byte-identical to pre-ADR.
 */
@Injectable()
export class AbilityFactory {
  createForPrincipal(principal: AuthPrincipal): AppAbility {
    const matrix = this.buildRoleMatrix(principal);
    // HUMAN (or any non-AGENT principal): the full role matrix, unchanged.
    if (principal.principalType !== 'AGENT') return matrix;
    // AGENT: deny-by-default, effective = matrix(role) ∩ scope; wildcard unreachable (ADR-0037 §1).
    return this.intersectScope(matrix, principal.scope);
  }

  /** The role→ability ceiling from `rbac-matrix.md` (default-deny). Identical for every principal type. */
  private buildRoleMatrix(principal: AuthPrincipal): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    const uid = principal.userId;

    switch (principal.role) {
      case 'ADMIN':
        can('manage', 'all'); // ADMIN has full operator scope (matrix grants per-resource).
        break;

      case 'MODERATOR':
        can('read', 'all'); // read any (incl. pending) for moderation
        can('create', 'ModerationDecision');
        can('read', 'ModerationQueue');
        can(['read', 'update'], 'ContentReport'); // resolve reports
        can('update', 'Listing'); // moderation outcome on listings
        can('update', 'User'); // suspend/unsuspend per moderation
        can('read', 'AuditLog'); // own actions (narrowed at service layer)
        break;

      // USER + the capability roles (breeder/farmer/vet/groomer) inherit USER permissions.
      default:
        can('read', 'ReferenceData');
        can('read', 'User'); // public fields of others (narrowed at service layer)
        can(['read', 'update', 'delete'], 'User', { id: uid } as never); // own profile
        can('manage', 'Animal', { owner_id: uid } as never);
        can('read', 'Listing'); // any active (filtered in query)
        can('manage', 'Listing', { owner_id: uid } as never);
        can('read', 'Organization');
        can('read', 'Branch');
        can('manage', 'Favorite', { user_id: uid } as never);
        can('manage', 'SavedSearch', { user_id: uid } as never);
        can('read', 'Notification', { user_id: uid } as never);
        can('create', 'ContentReport');
        can('read', 'ContentReport', { reporter_id: uid } as never);
        break;
    }

    return build();
  }

  /**
   * ADR-0037 §1 — AGENT effective ability = `matrix(role) ∩ scope`, deny-by-default.
   *
   * Start from deny-all; for each scope grant, grant it ONLY if the role ceiling would allow that
   * `{action, subject}` — carrying the ceiling rule's conditions through (so an owner-scoped role rule
   * stays owner-scoped for the agent, a true intersection, never a widening). The `manage` action and
   * the `all` subject are never emitted for an AGENT (defense-in-depth beyond the scope validator), so
   * `manage:all` is structurally unreachable even at `role='ADMIN'`. Empty/undefined scope ⇒ nothing.
   */
  private intersectScope(ceiling: AppAbility, scope: ScopeGrant[] | undefined): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    for (const grant of scope ?? []) {
      // A scope should never carry the wildcard (validator-enforced) — belt-and-braces skip here too.
      if ((grant.action as string) === 'manage' || (grant.subject as string) === 'all') continue;
      const rule = this.matchingCeilingRule(ceiling, grant.action, grant.subject);
      if (!rule) continue; // the role ceiling forbids it → deny-by-default
      if (rule.conditions) {
        can(grant.action, grant.subject, rule.conditions as never);
      } else {
        can(grant.action, grant.subject);
      }
    }
    return build();
  }

  /**
   * Find the first non-inverted role-matrix rule that grants `{action, subject}`, honouring the
   * casl wildcards (`manage` action, `all` subject). Returns the rule (with its conditions) or
   * `undefined` when the ceiling does not allow it.
   *
   * LIMITATION (forward-compat): this only reads GRANT (`can`) rules — it skips `inverted` (`cannot`)
   * rules. `buildRoleMatrix` emits none today (verified by the canary test in the agent-scope spec), so
   * the intersection is correct. If a Phase-2 domain rule ever adds a `cannot` to the matrix, this
   * intersection must be taught to subtract it BEFORE that rule ships — otherwise an AGENT scope could
   * be granted an ability the human role is explicitly denied. The canary test fails first to force it.
   */
  private matchingCeilingRule(
    ceiling: AppAbility,
    action: string,
    subject: string,
  ): RawRuleOf<AppAbility> | undefined {
    return ceiling.rules.find((r) => {
      if (r.inverted) return false; // see LIMITATION above — cannot-rules are not yet subtracted
      const actions = Array.isArray(r.action) ? r.action : [r.action];
      const subjects = Array.isArray(r.subject) ? r.subject : [r.subject ?? 'all'];
      const actionOk = actions.includes('manage') || actions.includes(action as never);
      const subjectOk = subjects.includes('all') || subjects.includes(subject as never);
      return actionOk && subjectOk;
    });
  }
}
