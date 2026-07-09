import { randomBytes, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, service_credentials, users } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { RedisService } from '../../lib/redis/redis.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { CryptoService } from '../../lib/crypto/crypto.service';
import { FeatureToggleService } from '../../lib/feature-toggle/feature-toggle.service';
import { TokenService } from '../auth/token.service';
import type { AuthPrincipal, Role } from '../../lib/auth/principal';
import { CapabilityProfileService } from './capability-profile.service';
import type {
  AgentAccessTokenView,
  CredentialIssuedView,
  IssueCredentialDto,
  RotateCredentialDto,
} from './dto/agent-auth.dto';

/** ADR-0036 §6 master gate — off in MVP → the exchange issues no AGENT JWT. */
const MASTER_GATE = 'agent_service_auth';
/** Self-identifying token prefix (ADR-0036 §3.1) — lets a secret-scanner recognise the token type. */
const TOKEN_PREFIX = 'zlk_agent_';
/** 256-bit random secret (ADR-0036 §3.1). base64url(32 bytes) = 43 chars, full entropy. */
const SECRET_BYTES = 32;
/** RFC-4122 UUID shape — a credId must match before we touch the DB (no non-uuid query, no oracle). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Redis-INCR exchange rate-limit (ADR-0036 §3.4), uniform with the transfer/contact-reveal limiter. */
const RATE_WINDOW_SEC = 3600;
const CRED_LIMIT_PER_HOUR = 30; // per-credId: throttles a brute-force against one credential
const IP_LIMIT_PER_HOUR = 60; // per-IP: throttles credential-stuffing across many credIds

interface ParsedCredential {
  credId: string;
  secret: string;
}

/**
 * ADR-0036 (credential issuance) + ADR-0037 (scoped ability) — the agent-auth core.
 *
 * A human ADMIN issues/rotates/revokes a `service_credentials` secret for an AGENT account; a machine
 * exchanges that secret at `POST /v1/auth/agent/token` for a short-lived AGENT JWT (with the resolved
 * least-privilege scope claim). The long-lived secret is HMAC-hashed at rest (never plaintext), touches
 * only the rate-limited exchange endpoint, and any verify failure returns ONE uniform 401 (no oracle).
 * Behaviour is gated by the `agent_service_auth` master toggle (off in MVP → 403 at exchange).
 */
@Injectable()
export class AgentCredentialService {
  private readonly logger = new Logger(AgentCredentialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditLogService,
    private readonly crypto: CryptoService,
    private readonly toggles: FeatureToggleService,
    private readonly tokens: TokenService,
    private readonly profiles: CapabilityProfileService,
  ) {}

  // ── Issuance (HUMAN ADMIN only; ADR-0036 §2) ──────────────────────────────────────────────────
  /**
   * Issue a fresh credential for an existing AGENT account. Returns the plaintext token ONCE (only the
   * HMAC `secret_hash` persists). 404 if the target user is absent; 422 if it is not an AGENT account or
   * the referenced capability profile does not exist.
   */
  async issue(actor: AuthPrincipal, agentUserId: string, dto: IssueCredentialDto): Promise<CredentialIssuedView> {
    this.assertHumanActor(actor);
    await this.assertAgentTarget(agentUserId);
    await this.assertProfileExists(dto.capabilityProfileId);
    const expiresAt = this.parseExpiry(dto.expiresAt);

    const credId = randomUUID();
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const row = await this.prisma.service_credentials.create({
      data: {
        id: credId,
        agent_user_id: agentUserId,
        label: dto.label ?? null,
        secret_hash: this.crypto.agentCredentialHash(secret),
        issued_by: actor.userId,
        capability_profile_id: dto.capabilityProfileId ?? null,
        expires_at: expiresAt,
      },
    });
    await this.auditCredential(actor, 'agent_credential.issued', row, {
      agent_user_id: agentUserId,
      capability_profile_id: row.capability_profile_id,
      expires_at: row.expires_at,
    });
    this.logger.log(`Agent credential ${credId} issued for ${agentUserId} by ${actor.userId}`);
    return this.toIssuedView(row, secret);
  }

  // ── Rotation (issue-new, link rotated_from; do NOT auto-revoke old; ADR-0036 §4) ───────────────
  async rotate(actor: AuthPrincipal, credId: string, dto: RotateCredentialDto): Promise<CredentialIssuedView> {
    this.assertHumanActor(actor);
    const old = await this.load(credId);
    await this.assertProfileExists(dto.capabilityProfileId);
    const expiresAt = this.parseExpiry(dto.expiresAt);

    const newId = randomUUID();
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const row = await this.prisma.service_credentials.create({
      data: {
        id: newId,
        agent_user_id: old.agent_user_id,
        label: dto.label ?? old.label,
        secret_hash: this.crypto.agentCredentialHash(secret),
        issued_by: actor.userId,
        capability_profile_id: dto.capabilityProfileId ?? old.capability_profile_id,
        expires_at: expiresAt,
        rotated_from: old.id,
      },
    });
    await this.auditCredential(actor, 'agent_credential.rotated', row, {
      agent_user_id: old.agent_user_id,
      rotated_from: old.id,
      capability_profile_id: row.capability_profile_id,
    });
    this.logger.log(`Agent credential ${old.id} rotated → ${newId} by ${actor.userId} (old NOT auto-revoked)`);
    return this.toIssuedView(row, secret);
  }

  // ── Revocation (immediate; idempotent; ADR-0036 §4) ───────────────────────────────────────────
  async revoke(actor: AuthPrincipal, credId: string): Promise<void> {
    this.assertHumanActor(actor);
    const cred = await this.load(credId);
    if (!cred.is_active) return; // already revoked → idempotent no-op (still 204)
    await this.prisma.service_credentials.update({
      where: { id: credId },
      data: { is_active: false, revoked_at: new Date() },
    });
    await this.auditCredential(actor, 'agent_credential.revoked', cred, { agent_user_id: cred.agent_user_id });
    this.logger.log(`Agent credential ${credId} revoked by ${actor.userId}`);
  }

  // ── Exchange (secret → short-lived AGENT JWT; ADR-0036 §1/§3) ──────────────────────────────────
  async exchange(rawCredential: string, ip: string | undefined): Promise<AgentAccessTokenView> {
    // Master gate (ADR-0036 §6): off in MVP → issue no AGENT JWT. This is a global gate, not a
    // per-credential oracle, so a distinct 403 is safe (and correct — the feature is disabled).
    if (!(await this.toggles.isEnabled(MASTER_GATE))) {
      throw new ForbiddenException({ message: 'Agent service-auth is not enabled', code: 'AGENT_AUTH_DISABLED' });
    }
    // Throttle by IP first (always), then by credId — brute-force / credential-stuffing defence.
    await this.enforceRateLimit(`agent-token:rl:ip:${ip ?? 'unknown'}`, IP_LIMIT_PER_HOUR);
    const parsed = this.parseCredential(rawCredential);
    if (!parsed) throw this.uniform401();
    await this.enforceRateLimit(`agent-token:rl:cred:${parsed.credId}`, CRED_LIMIT_PER_HOUR);

    // Compute the HMAC unconditionally (constant work whether or not the credId exists) then load.
    const presentedHash = this.crypto.agentCredentialHash(parsed.secret);
    const cred = await this.loadForVerify(parsed.credId);

    const now = Date.now();
    const user = cred?.users;
    const live =
      cred !== null &&
      cred.is_active &&
      cred.revoked_at === null &&
      (cred.expires_at === null || cred.expires_at.getTime() > now);
    const okUser = !!user && user.principal_type === 'AGENT' && user.is_active;
    const okSecret = cred !== null && this.crypto.safeEqual(presentedHash, cred.secret_hash);
    // ANY miss mode (unknown id / inactive / revoked / expired / non-agent / mismatch) → ONE 401.
    if (!live || !okUser || !okSecret) {
      throw this.uniform401();
    }

    const scope = await this.profiles.resolveScope(cred.capability_profile_id);
    const principal: AuthPrincipal = {
      userId: cred.agent_user_id,
      role: user.role as Role,
      principalType: 'AGENT',
      scope, // undefined → deny-by-default at the AbilityFactory
    };
    const accessToken = this.tokens.signAccess(principal);
    // last_used_at is best-effort operability — never gate the exchange on it.
    void this.touchLastUsed(cred.id);
    return { accessToken, tokenType: 'Bearer' };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────────────────────
  /**
   * ADR-0036 §2 — credential issuance/rotation/revocation is a HUMAN-only capability (the trust root
   * terminates in an accountable human; the rejected §2 Option-3 anti-pattern is "an agent issues an
   * agent"). RolesGuard is principal-agnostic (ADR-0011 §7: an AGENT may hold role='ADMIN'), so the
   * `@Roles('ADMIN')` route gate alone would let an AGENT-ADMIN reach issuance — this service-layer
   * guard closes that structurally. ADR-0037 additionally keeps credential-issuance out of every AGENT
   * scope, so this is defense-in-depth on the principal type itself.
   */
  private assertHumanActor(actor: AuthPrincipal): void {
    if (actor.principalType !== 'HUMAN') {
      throw new ForbiddenException({
        message: 'Credential issuance is a HUMAN-only capability',
        code: 'ISSUANCE_HUMAN_ONLY',
      });
    }
  }

  private async assertAgentTarget(agentUserId: string): Promise<users> {
    const user = await this.prisma.users.findUnique({ where: { id: agentUserId } });
    if (!user) {
      throw new NotFoundException({ message: 'Agent account not found', code: 'NOT_FOUND' });
    }
    if (user.principal_type !== 'AGENT') {
      throw new UnprocessableEntityException({
        message: 'Credentials can only be issued for an AGENT account',
        code: 'TARGET_NOT_AGENT',
      });
    }
    return user;
  }

  private async assertProfileExists(profileId: number | undefined): Promise<void> {
    if (profileId === undefined) return;
    const profile = await this.prisma.agent_capability_profiles.findUnique({ where: { id: profileId } });
    if (!profile) {
      throw new UnprocessableEntityException({
        message: 'Capability profile not found',
        code: 'CAPABILITY_PROFILE_NOT_FOUND',
      });
    }
  }

  private async load(credId: string): Promise<service_credentials> {
    const cred = await this.prisma.service_credentials.findUnique({ where: { id: credId } });
    if (!cred) {
      throw new NotFoundException({ message: 'Credential not found', code: 'NOT_FOUND' });
    }
    return cred;
  }

  private loadForVerify(
    credId: string,
  ): Promise<Prisma.service_credentialsGetPayload<{ include: { users: true } }> | null> {
    return this.prisma.service_credentials.findUnique({
      where: { id: credId },
      include: { users: true },
    });
  }

  private async touchLastUsed(credId: string): Promise<void> {
    try {
      await this.prisma.service_credentials.update({
        where: { id: credId },
        data: { last_used_at: new Date() },
      });
    } catch {
      // best-effort only (ADR-0036 §7) — a failed stamp must never fail the exchange.
    }
  }

  /** Parse `zlk_agent_<credId>_<secret>`. credId is a UUID (no `_`), so split on the FIRST `_`. */
  private parseCredential(raw: string): ParsedCredential | null {
    if (typeof raw !== 'string' || !raw.startsWith(TOKEN_PREFIX)) return null;
    const rest = raw.slice(TOKEN_PREFIX.length);
    const sep = rest.indexOf('_');
    if (sep <= 0) return null;
    const credId = rest.slice(0, sep);
    const secret = rest.slice(sep + 1);
    if (!UUID_RE.test(credId) || secret.length === 0) return null;
    return { credId, secret };
  }

  private parseExpiry(iso: string | undefined): Date | null {
    if (iso === undefined) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new UnprocessableEntityException({ message: 'Invalid expiresAt', code: 'VALIDATION_ERROR' });
    }
    return d;
  }

  private uniform401(): UnauthorizedException {
    // Single uniform failure for every mode (no existence/timing oracle) — the claim-code discipline.
    return new UnauthorizedException({ message: 'Invalid agent credential', code: 'INVALID_AGENT_CREDENTIAL' });
  }

  private async auditCredential(
    actor: AuthPrincipal,
    action: string,
    row: service_credentials,
    afterData: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      actorPrincipalType: actor.principalType, // HUMAN — issuance is a human act (ADR-0036 §5)
      action,
      entityType: 'service_credential',
      entityId: row.id, // the credId only — the secret is NEVER logged
      afterData,
    });
  }

  private toIssuedView(row: service_credentials, secret: string): CredentialIssuedView {
    return {
      id: row.id,
      agentUserId: row.agent_user_id,
      secret: `${TOKEN_PREFIX}${row.id}_${secret}`,
      capabilityProfileId: row.capability_profile_id,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      rotatedFrom: row.rotated_from,
      createdAt: row.created_at.toISOString(),
    };
  }

  /**
   * Per-key hourly Redis-INCR rate limit (uniform with the transfer/contact-reveal limiter). The first
   * hit sets the TTL; a count over `limit` → 429 `RATE_LIMITED` with `retryAfter` (the key TTL), which
   * the problem filter renders as the `Retry-After` header.
   */
  private async enforceRateLimit(key: string, limit: number): Promise<void> {
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, RATE_WINDOW_SEC);
    }
    if (count > limit) {
      const ttl = await this.redis.client.ttl(key);
      const retryAfter = ttl > 0 ? ttl : RATE_WINDOW_SEC;
      throw new HttpException(
        { message: 'Rate limit reached; retry later', code: 'RATE_LIMITED', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
