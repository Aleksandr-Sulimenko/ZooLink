import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type users } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import { AuthService } from '../auth/auth.service';
import { toUserProfile, type UserProfile } from './user-profile.util';
import type { UpdateProfileDto } from './dto/identity.dto';

const DEACTIVATION_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30-day recoverable grace (spec 01)

/** Self-service profile (/me): read, update (optimistic-concurrency), deactivate/reactivate. */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly auth: AuthService,
  ) {}

  async getMe(userId: string): Promise<{ profile: UserProfile; etag: string }> {
    const user = await this.load(userId);
    return { profile: toUserProfile(user), etag: this.etag(user) };
  }

  async updateMe(
    userId: string,
    dto: UpdateProfileDto,
    ifMatch: string | undefined,
  ): Promise<{ profile: UserProfile; etag: string }> {
    const user = await this.load(userId);
    assertIfMatch(ifMatch, this.etag(user)); // 428 if missing, 412 if stale

    const data: Prisma.usersUncheckedUpdateInput = {};
    if (dto.fullName !== undefined) data.full_name = dto.fullName;
    if (dto.cityId !== undefined) data.city_id = dto.cityId;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.avatarUrl !== undefined) data.avatar_url = dto.avatarUrl;
    if (dto.preferredLanguage !== undefined) data.preferred_language = dto.preferredLanguage;

    if (Object.keys(data).length === 0) {
      return { profile: toUserProfile(user), etag: this.etag(user) };
    }

    let updated: users;
    try {
      updated = await this.prisma.users.update({ where: { id: userId }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BadRequestException({ message: 'Unknown cityId', code: 'VALIDATION_ERROR' });
      }
      throw err;
    }

    await this.audit.record({
      actorId: userId,
      actorRole: updated.role,
      action: 'identity.profile_updated',
      entityType: 'user',
      entityId: userId,
      afterData: { fields: Object.keys(data) },
    });
    return { profile: toUserProfile(updated), etag: this.etag(updated) };
  }

  /** Soft-deactivate (recoverable for 30 days) + revoke all sessions. Idempotent. */
  async deactivateMe(userId: string): Promise<void> {
    const user = await this.load(userId);
    if (user.status === 'DEACTIVATED') return;
    if (user.status !== 'ACTIVE' && user.status !== 'VERIFIED') {
      throw new ConflictException({ message: 'Account cannot be deactivated from its current state', code: 'CONFLICT' });
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { status: 'DEACTIVATED', deactivated_at: new Date(), is_active: false },
    });
    await this.auth.logout(userId); // revoke all refresh-token families
    await this.audit.record({
      actorId: userId, actorRole: user.role, action: 'identity.account_deactivated', entityType: 'user', entityId: userId,
    });
    this.logger.log(`Account deactivated: ${userId}`);
  }

  /** Reactivate within the grace window. (Auth path for an already-locked-out account is Slice 4 recovery.) */
  async reactivateMe(userId: string): Promise<UserProfile> {
    const user = await this.load(userId);
    if (user.status !== 'DEACTIVATED') {
      throw new BadRequestException({ message: 'Account is not deactivated', code: 'VALIDATION_ERROR' });
    }
    if (user.deactivated_at && Date.now() - user.deactivated_at.getTime() > DEACTIVATION_GRACE_MS) {
      throw new BadRequestException({ message: 'Grace period elapsed; account is not recoverable', code: 'VALIDATION_ERROR' });
    }
    const updated = await this.prisma.users.update({
      where: { id: userId },
      data: { status: 'ACTIVE', deactivated_at: null, is_active: true },
    });
    await this.audit.record({
      actorId: userId, actorRole: updated.role, action: 'identity.account_reactivated', entityType: 'user', entityId: userId,
    });
    return toUserProfile(updated);
  }

  /**
   * Self-service right-to-erasure (ФЗ-152, spec 01 Slice-4). Canonical path = deactivate → 30-day
   * grace → anonymise. In the MVP there is no scheduler to run the grace job, so this deactivates
   * immediately (if still active) and records the erasure request in audit_log; the actual
   * `erase_user` anonymisation is run after grace by the retention job / an ADMIN. Idempotent.
   */
  async eraseMe(userId: string): Promise<void> {
    const user = await this.load(userId);
    if (user.status !== 'DEACTIVATED' && user.status !== 'SUSPENDED') {
      await this.prisma.users.update({
        where: { id: userId },
        data: { status: 'DEACTIVATED', deactivated_at: new Date(), is_active: false },
      });
      await this.auth.logout(userId);
    }
    await this.audit.record({
      actorId: userId, actorRole: user.role, action: 'identity.erasure_requested', entityType: 'user', entityId: userId,
    });
    this.logger.log(`Erasure requested (self) for ${userId}`);
  }

  private etag(user: users): string {
    return weakEtag(user.id, user.updated_at);
  }

  private async load(userId: string): Promise<users> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ message: 'Account not found', code: 'UNAUTHENTICATED' });
    return user;
  }
}
