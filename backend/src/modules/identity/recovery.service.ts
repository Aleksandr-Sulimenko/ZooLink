import { createHmac } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../../lib/providers';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import type { AuthPrincipal, PrincipalType, Role } from '../../lib/auth/principal';
import { AuthService } from '../auth/auth.service';
import { OtpService, OtpCooldownError } from './otp.service';
import { toUserProfile } from './user-profile.util';
import type { AuthResponse } from './identity.service';
import type { RecoverEmailRequestDto, RecoverEmailVerifyDto } from './dto/identity.dto';

/** Redis namespace isolating recovery OTPs from registration OTPs (otp.service.ts). */
const RECOVER_NS = 'recover:email';
/** 30-day recoverable grace for DEACTIVATED accounts (mirrors profile.service.ts). */
const DEACTIVATION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/** Statuses a recovery flow may resurrect a session for. */
const NON_RECOVERABLE = new Set(['SUSPENDED']);

/**
 * Account recovery via a verified secondary channel (spec 01 Slice-4). A user who lost their phone
 * or OAuth but kept a VERIFIED email receives an email OTP and, on confirmation, a fresh session.
 * Never enumerates accounts (request always 202). Reuses the OtpService lifecycle under a separate
 * Redis namespace so a recovery code can never satisfy a registration verify (or vice-versa).
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly audit: AuditLogService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  /** Keyed digest of the normalised email — never store the raw email in a Redis key. */
  private subject(email: string): string {
    return createHmac('sha256', this.config.get('PHONE_HASH_PEPPER'))
      .update(email.trim().toLowerCase())
      .digest('base64url');
  }

  /**
   * Send a recovery OTP to the verified email IF a matching recoverable account exists. Always
   * resolves to a 202-shaped response regardless (no account enumeration). A cooldown breach for a
   * real account still surfaces 429 (the attacker cannot tell apart a non-existent email, which
   * never sets a cooldown key).
   */
  async requestEmail(
    dto: RecoverEmailRequestDto,
  ): Promise<{ status: 'VERIFICATION_REQUIRED'; expiresInSeconds: number }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.users.findFirst({
      where: { email, email_verified: true, erased_at: null },
    });

    // Constant-ish response: only actually send when there is a recoverable account.
    if (user && !NON_RECOVERABLE.has(user.status)) {
      let issued: { code: string; expiresInSeconds: number };
      try {
        issued = await this.otp.issue(this.subject(email), RECOVER_NS);
      } catch (err) {
        if (err instanceof OtpCooldownError) {
          throw new HttpException(
            { message: `Please wait ${err.retryAfterSeconds}s before requesting a new code`, code: 'RATE_LIMITED' },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw err;
      }
      await this.email.sendEmail({
        to: email,
        subject: this.subjectLine(user.preferred_language),
        text: this.body(issued.code, user.preferred_language),
      });
      await this.audit.record({
        actorId: user.id, actorRole: user.role, action: 'identity.recovery_requested', entityType: 'user', entityId: user.id,
      });
      return { status: 'VERIFICATION_REQUIRED', expiresInSeconds: issued.expiresInSeconds };
    }

    // No recoverable account → pretend success with the canonical TTL.
    return { status: 'VERIFICATION_REQUIRED', expiresInSeconds: 300 };
  }

  /** Validate the recovery OTP and issue a session (reactivating a within-grace DEACTIVATED account). */
  async verifyEmail(dto: RecoverEmailVerifyDto): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();
    const subject = this.subject(email);

    const user = await this.prisma.users.findFirst({
      where: { email, email_verified: true, erased_at: null },
    });
    // Run verify even when no user, to keep timing/behaviour uniform, but a missing user always 400s.
    const result = user ? await this.otp.verify(subject, dto.code, RECOVER_NS) : 'INVALID';

    if (result === 'LOCKED') {
      if (user) {
        await this.audit.record({
          actorId: user.id, actorRole: user.role, action: 'identity.recovery_locked_out', entityType: 'user', entityId: user.id,
        });
      }
      throw new HttpException({ message: 'Too many attempts; try again later', code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (result === 'INVALID' || !user) {
      throw new HttpException({ message: 'Invalid or expired code', code: 'INVALID_OTP' }, HttpStatus.BAD_REQUEST);
    }

    if (NON_RECOVERABLE.has(user.status)) {
      throw new ForbiddenException({ message: 'Account is not recoverable; contact support', code: 'FORBIDDEN' });
    }

    // Reactivate a DEACTIVATED account if still within grace; refuse past grace.
    let target = user;
    if (user.status === 'DEACTIVATED') {
      if (user.deactivated_at && Date.now() - user.deactivated_at.getTime() > DEACTIVATION_GRACE_MS) {
        throw new ForbiddenException({ message: 'Grace period elapsed; account is not recoverable', code: 'FORBIDDEN' });
      }
      target = await this.prisma.users.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', deactivated_at: null, is_active: true, last_login_at: new Date() },
      });
    } else {
      target = await this.prisma.users.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      });
    }

    await this.audit.record({
      actorId: target.id, actorRole: target.role, action: 'identity.recovery_succeeded', entityType: 'user', entityId: target.id,
    });

    const principal: AuthPrincipal = {
      userId: target.id,
      role: target.role as Role,
      principalType: target.principal_type as PrincipalType,
    };
    const tokens = await this.auth.issueSession(principal);
    this.logger.log(`Account recovered via email OTP: ${target.id}`);
    return { ...tokens, user: toUserProfile(target) };
  }

  private subjectLine(language: string): string {
    return language === 'en' ? 'ZooLink account recovery code' : 'ZooLink: код восстановления доступа';
  }

  private body(code: string, language: string): string {
    return language === 'en'
      ? `ZooLink: your account recovery code is ${code}. Valid for 5 min. If you did not request this, ignore this email.`
      : `ZooLink: код восстановления доступа ${code}. Действует 5 мин. Если вы не запрашивали — проигнорируйте письмо.`;
  }
}
