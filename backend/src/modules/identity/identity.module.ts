import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { MeController } from './me.controller';
import { AdminUserController } from './admin-user.controller';
import { IdentityService } from './identity.service';
import { ProfileService } from './profile.service';
import { RecoveryService } from './recovery.service';
import { AdminUserService } from './admin-user.service';
import { OtpService } from './otp.service';
import { OAuthRegistry } from './oauth/oauth.registry';

/**
 * Identity domain (Phase 2). Slices: passwordless phone OTP register/verify, OAuth login, /me
 * profile, and Slice-4 (email-OTP recovery, ADMIN role-elevation/rebind, ФЗ-152 erase_user).
 * Builds on Phase-1 platform: AuthService (sessions), SMS_PROVIDER / EMAIL_PROVIDER (OTP delivery),
 * RedisService (OTP state), PrismaService (users), AuditLogService.
 */
@Module({
  controllers: [IdentityController, MeController, AdminUserController],
  providers: [IdentityService, ProfileService, RecoveryService, AdminUserService, OtpService, OAuthRegistry],
  exports: [IdentityService, AdminUserService],
})
export class IdentityModule {}
