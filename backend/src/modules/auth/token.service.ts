import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenClaims, AuthPrincipal } from '../../lib/auth/principal';
import { parseScopeClaim } from '../../lib/auth/scope';

/**
 * Stateless access-token machinery. Access tokens are short-lived JWTs (15 min, HS256) carrying
 * the principal's identity, role, and principal_type (HUMAN|AGENT, ADR-0006). AGENT tokens (minted by
 * the credential exchange, ADR-0036) additionally carry a least-privilege `scope` claim (ADR-0037).
 * Refresh tokens are NOT JWTs — they are opaque and DB-backed (see RefreshTokenService), and an AGENT
 * gets NO refresh token (it re-exchanges its credential).
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(principal: AuthPrincipal): string {
    const payload: Record<string, unknown> = {
      role: principal.role,
      principal_type: principal.principalType,
    };
    // Scope rides only on AGENT tokens; a HUMAN principal never carries it → HUMAN tokens are
    // byte-identical to pre-ADR (the parity guarantee, ADR-0037 §5).
    if (principal.scope && principal.scope.length > 0) {
      payload.scope = principal.scope;
    }
    return this.jwt.sign(payload, { subject: principal.userId });
  }

  /** Verifies signature + expiry. Throws if invalid/expired (caller maps to 401). */
  verifyAccess(token: string): AuthPrincipal {
    // Pin HS256 explicitly at the call site too (defence-in-depth over the module verifyOptions) so
    // alg-confusion / "alg":"none" tokens are rejected regardless of module wiring — AUDIT3 #3.
    const claims = this.jwt.verify<AccessTokenClaims>(token, { algorithms: ['HS256'] });
    return {
      userId: claims.sub,
      role: claims.role,
      principalType: claims.principal_type,
      // parseScopeClaim fails safe: a malformed/wildcard scope claim narrows, never widens.
      scope: parseScopeClaim(claims.scope),
    };
  }
}
