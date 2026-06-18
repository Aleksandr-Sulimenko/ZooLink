import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
} from '@casl/ability';
import type { AuthPrincipal } from './principal';

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
 * map as each domain lands in Phase 2. AGENT principals are subject to the same matrix (ADR-0006).
 */
@Injectable()
export class AbilityFactory {
  createForPrincipal(principal: AuthPrincipal): AppAbility {
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
}
