import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import { assertValidScope, parseScopeClaim, type ScopeGrant } from '../../lib/auth/scope';

/**
 * ADR-0037 §2 — resolves a credential's named capability profile into the least-privilege scope the
 * token exchange embeds in the AGENT JWT, and validates a scope against the no-wildcard vocabulary.
 *
 * Deny-by-default is enforced end-to-end here: a NULL `capability_profile_id`, an inactive profile, a
 * missing profile, or an empty/malformed grant list all resolve to `undefined` scope → the exchange
 * mints a JWT with NO scope → the AbilityFactory grants the agent NOTHING.
 */
@Injectable()
export class CapabilityProfileService {
  private readonly logger = new Logger(CapabilityProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the active scope for a credential's `capability_profile_id`. Returns `undefined`
   * (deny-by-default) when the profile is absent/inactive/empty or the stored scope is malformed or
   * contains a wildcard (defense-in-depth: a wildcard is dropped by `parseScopeClaim`, never honoured).
   */
  async resolveScope(profileId: number | null): Promise<ScopeGrant[] | undefined> {
    if (profileId === null || profileId === undefined) return undefined; // deny-by-default
    const profile = await this.prisma.agent_capability_profiles.findUnique({ where: { id: profileId } });
    if (!profile || !profile.is_active) return undefined; // missing / disabled → nothing
    const scope = parseScopeClaim(profile.scope);
    if (!scope) {
      this.logger.warn(`Capability profile ${profileId} resolved to an empty/invalid scope → deny-by-default`);
      return undefined;
    }
    return scope;
  }

  /**
   * Validate a scope before it is persisted on a profile (ADR-0037 §2): rejects `manage`/`all` and
   * malformed grants. Throws a plain `Error` (stable message) — the caller maps it to 422 `INVALID_SCOPE`.
   * Exposed for the profile-management path (no admin CRUD endpoint ships in this slice; the seeded
   * `moderation-agent` profile is the only live profile in MVP).
   */
  validate(scope: unknown): asserts scope is ScopeGrant[] {
    assertValidScope(scope);
  }
}
