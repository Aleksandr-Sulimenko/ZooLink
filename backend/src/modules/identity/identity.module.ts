import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { MeController } from './me.controller';
import { IdentityService } from './identity.service';
import { ProfileService } from './profile.service';
import { OtpService } from './otp.service';
import { OAuthRegistry } from './oauth/oauth.registry';

/**
 * Identity domain (Phase 2). First slice: passwordless phone registration + SMS OTP verification.
 * Builds on Phase-1 platform: AuthService (sessions), SMS_PROVIDER (OTP delivery), RedisService
 * (OTP state), PrismaService (users). OAuth / profile (/me) / recovery land in later slices.
 */
@Module({
  controllers: [IdentityController, MeController],
  providers: [IdentityService, ProfileService, OtpService, OAuthRegistry],
  exports: [IdentityService],
})
export class IdentityModule {}
