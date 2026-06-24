import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/app-config.service';
import { JwtAuthGuard } from '../../lib/auth/jwt-auth.guard';
import { RolesGuard } from '../../lib/auth/roles.guard';
import { PoliciesGuard } from '../../lib/auth/policies.guard';
import { AbilityFactory } from '../../lib/auth/ability.factory';
import { BearerJwtAuthenticator } from '../../lib/auth/bearer-jwt.authenticator';
import {
  REQUEST_AUTHENTICATORS,
  type RequestAuthenticator,
} from '../../lib/auth/request-authenticator';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * Auth-core (Phase 1): access-JWT signing/verification, DB-backed refresh-token rotation, and a
 * GLOBAL JwtAuthGuard (opt out with @Public()). Identity (Phase 2) builds login/OTP/OAuth on top
 * and calls AuthService.issueSession. Global so the guard and token services are app-wide.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    TokenService,
    RefreshTokenService,
    AuthService,
    AbilityFactory,
    // ADR-0011 §5: ordered authenticator chain consumed by JwtAuthGuard (source-agnostic principal).
    // BearerJwt is the only link today; AgentServiceToken slots in additively later (gated). Order =
    // priority (first non-null principal wins).
    BearerJwtAuthenticator,
    {
      provide: REQUEST_AUTHENTICATORS,
      inject: [BearerJwtAuthenticator],
      useFactory: (bearer: BearerJwtAuthenticator): RequestAuthenticator[] => [bearer],
    },
    // Global guard chain (registration order = execution order): authenticate, then coarse role
    // gate, then CASL policy gate. Each is metadata-gated (no decorator → pass).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PoliciesGuard },
  ],
  exports: [TokenService, AuthService, RefreshTokenService, AbilityFactory],
})
export class AuthModule {}
