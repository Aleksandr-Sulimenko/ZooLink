import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenClaims, AuthPrincipal } from '../../lib/auth/principal';

/**
 * Stateless access-token machinery. Access tokens are short-lived JWTs (15 min, HS256) carrying
 * the principal's identity, role, and principal_type (HUMAN|AGENT, ADR-0006). Refresh tokens are
 * NOT JWTs — they are opaque and DB-backed (see RefreshTokenService).
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(principal: AuthPrincipal): string {
    return this.jwt.sign(
      { role: principal.role, principal_type: principal.principalType },
      { subject: principal.userId },
    );
  }

  /** Verifies signature + expiry. Throws if invalid/expired (caller maps to 401). */
  verifyAccess(token: string): AuthPrincipal {
    const claims = this.jwt.verify<AccessTokenClaims>(token);
    return {
      userId: claims.sub,
      role: claims.role,
      principalType: claims.principal_type,
    };
  }
}
