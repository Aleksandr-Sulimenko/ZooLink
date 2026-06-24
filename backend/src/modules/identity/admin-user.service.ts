import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type users } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { AuthService } from '../auth/auth.service';
import type { AuthPrincipal, Role } from '../../lib/auth/principal';
import { normalizePhone, phoneHash } from './phone.util';
import { toUserProfile, type UserProfile } from './user-profile.util';
import type { RebindDto, SetRoleDto } from './dto/identity.dto';

const VALID_ROLES = new Set<Role>(['USER', 'MODERATOR', 'ADMIN', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER']);
const OAUTH_COLUMN = {
  google: 'oauth_google_id',
  apple: 'oauth_apple_id',
  telegram: 'oauth_telegram_id',
  vk: 'oauth_vk_id',
} as const;
type OAuthProvider = keyof typeof OAUTH_COLUMN;

/** Default notification prefs (mirror of the DB column default — used on erase reset). */
const DEFAULT_NOTIFICATION_PREFS = { email: true, sms: true, promo: false };
/** Default contact-visibility prefs (mirror of the DB column default — used on erase reset; ADR-0005). */
const DEFAULT_CONTACT_PREFS = { show_phone: true, show_telegram: false };

/**
 * ADMIN-only identity operations (spec 01 Slice-4): role-elevation, assisted identifier re-binding,
 * and the ФЗ-152 `erase_user` anonymisation procedure (data-governance.md §2). Every action is
 * audit-logged with the ADMIN as actor (no silent takeover) and revokes the target's sessions where
 * the round-4 rules require it.
 */
@Injectable()
export class AdminUserService {
  private readonly logger = new Logger(AdminUserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditLogService,
    private readonly auth: AuthService,
  ) {}

  /** Grant/change a role. Audit-logged; revokes ALL refresh families (round-4 "role change → revoke"). */
  async setRole(actor: AuthPrincipal, userId: string, dto: SetRoleDto): Promise<UserProfile> {
    if (!VALID_ROLES.has(dto.role)) {
      throw new BadRequestException({ message: 'Invalid role', code: 'VALIDATION_ERROR' });
    }
    const user = await this.load(userId);
    if (user.role === dto.role) {
      return toUserProfile(user); // no-op, no session churn
    }

    const updated = await this.prisma.users.update({ where: { id: userId }, data: { role: dto.role } });
    await this.auth.logout(userId); // revoke all families — token role claim is now stale
    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'identity.role_changed',
      entityType: 'user',
      entityId: userId,
      beforeData: { role: user.role },
      afterData: { role: dto.role },
    });
    this.logger.log(`Role changed ${user.role}→${dto.role} for ${userId} by ${actor.userId}`);
    return toUserProfile(updated);
  }

  /**
   * Re-bind exactly one identifier (phone OR an oauth id, or clear an oauth id). Audit-logged with
   * the ADMIN as actor; revokes the target's sessions. 409 if the new identifier is already taken.
   */
  async rebind(actor: AuthPrincipal, userId: string, dto: RebindDto): Promise<UserProfile> {
    await this.load(userId); // 404 if the target does not exist
    const data: Prisma.usersUncheckedUpdateInput = {};
    const auditAfter: Record<string, unknown> = {};

    const hasPhone = dto.newPhone !== undefined;
    const hasOauth = dto.oauthProvider !== undefined;
    if (hasPhone === hasOauth) {
      throw new BadRequestException({ message: 'Provide exactly one of newPhone or oauthProvider', code: 'VALIDATION_ERROR' });
    }

    if (hasPhone) {
      let normalized: string;
      try {
        normalized = normalizePhone(dto.newPhone as string);
      } catch {
        throw new BadRequestException({ message: 'Invalid phone number', code: 'VALIDATION_ERROR' });
      }
      data.phone_hash = phoneHash(normalized, this.config.get('PHONE_HASH_PEPPER'));
      auditAfter.identifier = 'phone';
    } else {
      const provider = dto.oauthProvider as OAuthProvider;
      const column = OAUTH_COLUMN[provider];
      if (dto.clear) {
        data[column] = null;
        auditAfter.identifier = `${provider}:cleared`;
      } else {
        if (!dto.oauthId) {
          throw new BadRequestException({ message: 'oauthId is required unless clear=true', code: 'VALIDATION_ERROR' });
        }
        data[column] = dto.oauthId;
        auditAfter.identifier = `${provider}:bound`;
      }
    }

    let updated: users;
    try {
      updated = await this.prisma.users.update({ where: { id: userId }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'Identifier already in use', code: 'CONFLICT' });
      }
      throw err;
    }

    await this.auth.logout(userId); // assisted recovery → invalidate any lingering sessions
    await this.audit.record({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'identity.identifier_rebound',
      entityType: 'user',
      entityId: userId,
      afterData: { ...auditAfter, reason: dto.reason ?? null },
    });
    this.logger.log(`Identifier rebound for ${userId} by ${actor.userId} (${String(auditAfter.identifier)})`);
    return toUserProfile(updated);
  }

  /** ADMIN-triggered erase. Idempotent. */
  async erase(actor: AuthPrincipal, userId: string): Promise<void> {
    const user = await this.load(userId);
    await this.eraseUser(user, { actorId: actor.userId, actorRole: actor.role });
  }

  /**
   * The `erase_user` procedure (data-governance.md §2): anonymise-in-place, keep the UUID.
   * Idempotent — a no-op if already erased. Shared by the admin and self-service triggers.
   */
  async eraseUser(user: users, actor: { actorId: string | null; actorRole: string | null }): Promise<void> {
    if (user.erased_at) return; // already anonymised

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: user.id },
        data: {
          phone_hash: null,
          oauth_google_id: null,
          oauth_apple_id: null,
          oauth_telegram_id: null,
          oauth_vk_id: null,
          email: null,
          email_verified: false,
          full_name: '[deleted]', // column is NOT NULL → tombstone (spec 01 Slice-4 reconciliation)
          avatar_url: null,
          // Contact-exchange PII (ADR-0005, data-governance.md §1; spec 01 round-8) — latent until contact-exchange
          // ships, but erased now to satisfy ФЗ-152 right-to-erasure ahead of the feature.
          contact_phone: null,
          contact_telegram: null,
          contact_prefs: DEFAULT_CONTACT_PREFS, // NOT NULL column → reset to default (cf. notification_prefs)
          last_login_at: null,
          notification_prefs: DEFAULT_NOTIFICATION_PREFS,
          status: 'DEACTIVATED',
          is_active: false,
          deactivated_at: user.deactivated_at ?? now,
          erased_at: now,
        },
      });
      // Redact notification PII for this user. recipient is NOT NULL → tombstone; content → NULL.
      await tx.notification_logs.updateMany({
        where: { user_id: user.id },
        data: { recipient: '[erased]', content: null },
      });
    });

    await this.auth.logout(user.id); // revoke all sessions
    await this.audit.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: 'user.erased',
      entityType: 'user',
      entityId: user.id,
    });
    this.logger.log(`User erased (anonymised) ${user.id} by ${actor.actorId ?? 'self'}`);
  }

  private async load(userId: string): Promise<users> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ message: 'User not found', code: 'NOT_FOUND' });
    return user;
  }
}
