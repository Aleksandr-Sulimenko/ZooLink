import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { SMS_PROVIDER, type SmsProvider } from '../../lib/providers';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import type { AuthPrincipal, PrincipalType, Role } from '../../lib/auth/principal';
import { AuthService, type TokenPair } from '../auth/auth.service';
import { OtpService, OtpCooldownError } from './otp.service';
import { normalizePhone, phoneHash } from './phone.util';
import type { RegisterPhoneDto, VerifyPhoneDto } from './dto/identity.dto';

/** Statuses that mean "this phone already owns a usable/recoverable account" → registration is a conflict. */
const TAKEN_STATUSES = new Set(['VERIFIED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']);

export interface UserProfile {
  id: string;
  fullName: string;
  role: Role;
  status: string;
  isActive: boolean;
  cityId: number | null;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
  preferredLanguage: string;
  createdAt: string;
}

export interface AuthResponse extends TokenPair {
  user: UserProfile;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly audit: AuditLogService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hash(phoneE164: string): string {
    return phoneHash(phoneE164, this.config.get('PHONE_HASH_PEPPER'));
  }

  private normalize(raw: string): string {
    try {
      return normalizePhone(raw);
    } catch {
      throw new BadRequestException({ message: 'Invalid phone number', code: 'VALIDATION_ERROR' });
    }
  }

  /** Passwordless registration: create (or reuse a pending) account and send an SMS OTP. */
  async registerPhone(dto: RegisterPhoneDto): Promise<{ status: 'VERIFICATION_REQUIRED'; expiresInSeconds: number }> {
    const phone = this.normalize(dto.phone);
    const ph = this.hash(phone);

    const existing = await this.prisma.users.findFirst({ where: { phone_hash: ph } });
    if (existing && TAKEN_STATUSES.has(existing.status)) {
      throw new ConflictException({ message: 'Phone already registered', code: 'CONFLICT' });
    }

    let userId = existing?.id;
    if (!existing) {
      try {
        const created = await this.prisma.users.create({
          data: {
            phone_hash: ph,
            full_name: dto.fullName,
            city_id: dto.cityId ?? null,
            email: dto.email ?? null,
            avatar_url: dto.avatarUrl ?? null,
            preferred_language: dto.preferredLanguage ?? 'ru',
            role: 'USER',
            principal_type: 'HUMAN',
            status: 'PENDING_VERIFICATION',
          },
        });
        userId = created.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') throw new ConflictException({ message: 'Phone already registered', code: 'CONFLICT' });
          if (err.code === 'P2003') throw new BadRequestException({ message: 'Unknown cityId', code: 'VALIDATION_ERROR' });
        }
        throw err;
      }
    }

    const expiresInSeconds = await this.sendOtp(ph, dto.preferredLanguage ?? existing?.preferred_language ?? 'ru', phone);
    await this.audit.record({
      actorId: userId ?? null,
      actorRole: 'USER',
      action: 'identity.register_initiated',
      entityType: 'user',
      entityId: userId ?? null,
    });
    return { status: 'VERIFICATION_REQUIRED', expiresInSeconds };
  }

  /** Validate the OTP, activate the account, and issue a session. */
  async verifyPhone(dto: VerifyPhoneDto): Promise<AuthResponse> {
    const phone = this.normalize(dto.phone);
    const ph = this.hash(phone);

    const user = await this.prisma.users.findFirst({ where: { phone_hash: ph } });
    if (!user) {
      throw new BadRequestException({ message: 'No pending verification for this phone', code: 'VALIDATION_ERROR' });
    }
    // Only an account awaiting verification may be activated here — never re-activate an
    // already-active/suspended/deactivated account via a stale OTP (race-safety).
    if (user.status !== 'UNVERIFIED' && user.status !== 'PENDING_VERIFICATION') {
      throw new ConflictException({ message: 'Account is not awaiting verification', code: 'CONFLICT' });
    }

    const result = await this.otp.verify(ph, dto.code);
    if (result === 'LOCKED') {
      // attempts exhausted → bounce back to UNVERIFIED (state machine) and lock out
      await this.prisma.users.update({ where: { id: user.id }, data: { status: 'UNVERIFIED', verification_attempts: 0 } });
      await this.audit.record({
        actorId: user.id, actorRole: 'USER', action: 'identity.verify_locked_out', entityType: 'user', entityId: user.id,
      });
      throw new HttpException({ message: 'Too many attempts; try again later', code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (result === 'INVALID') {
      await this.prisma.users.update({
        where: { id: user.id },
        data: { verification_attempts: await this.otp.attempts(ph) },
      });
      await this.audit.record({
        actorId: user.id, actorRole: 'USER', action: 'identity.verify_failed', entityType: 'user', entityId: user.id,
      });
      throw new BadRequestException({ message: 'Invalid or expired code', code: 'INVALID_OTP' });
    }

    const activated = await this.prisma.users.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', is_active: true, verification_attempts: 0, last_login_at: new Date() },
    });
    await this.audit.record({
      actorId: activated.id, actorRole: activated.role, action: 'identity.phone_verified', entityType: 'user', entityId: activated.id,
    });

    const principal: AuthPrincipal = {
      userId: activated.id,
      role: activated.role as Role,
      principalType: activated.principal_type as PrincipalType,
    };
    const tokens = await this.auth.issueSession(principal);
    this.logger.log(`Phone verified, account ACTIVE: ${activated.id}`);
    return { ...tokens, user: this.toProfile(activated) };
  }

  private async sendOtp(ph: string, language: string, phoneE164: string): Promise<number> {
    let issued: { code: string; expiresInSeconds: number };
    try {
      issued = await this.otp.issue(ph);
    } catch (err) {
      if (err instanceof OtpCooldownError) {
        throw new HttpException(
          { message: `Please wait ${err.retryAfterSeconds}s before requesting a new code`, code: 'RATE_LIMITED' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }
    await this.sms.sendSms({ to: phoneE164, text: otpText(issued.code, language) });
    return issued.expiresInSeconds;
  }

  private toProfile(u: {
    id: string;
    full_name: string;
    role: string;
    status: string;
    city_id: number | null;
    email: string | null;
    email_verified: boolean | null;
    avatar_url: string | null;
    preferred_language: string;
    created_at: Date;
  }): UserProfile {
    return {
      id: u.id,
      fullName: u.full_name,
      role: u.role as Role,
      status: u.status,
      isActive: u.status !== 'SUSPENDED' && u.status !== 'DEACTIVATED',
      cityId: u.city_id,
      email: u.email,
      emailVerified: u.email_verified ?? false,
      avatarUrl: u.avatar_url,
      preferredLanguage: u.preferred_language,
      createdAt: u.created_at.toISOString(),
    };
  }
}

/** Inline OTP SMS text. Template rendering proper moves to the Notification domain (later in Phase 2). */
function otpText(code: string, language: string): string {
  return language === 'en'
    ? `ZooLink: your verification code is ${code}. Valid for 5 min.`
    : `ZooLink: код подтверждения ${code}. Действует 5 мин.`;
}
