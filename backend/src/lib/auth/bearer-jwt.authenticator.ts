import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../../modules/auth/token.service';
import type { AuthPrincipal } from './principal';
import type { RequestAuthenticator } from './request-authenticator';

/**
 * ADR-0011 §5 — first (and currently only) link in the authenticator chain.
 *
 * Authenticates a request from an `Authorization: Bearer <access-jwt>` header (human end-users +
 * operators via phone-OTP/OAuth). Holds the exact verification semantics previously inlined in
 * JwtAuthGuard, so this extraction is behaviour-preserving:
 *  - no Bearer header           → returns null (credential absent; next link may try)
 *  - present but invalid/expired → throws (the credential IS ours but bad → guard maps to 401)
 */
@Injectable()
export class BearerJwtAuthenticator implements RequestAuthenticator {
  constructor(private readonly tokens: TokenService) {}

  tryAuthenticate(req: Request): AuthPrincipal | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      return this.tokens.verifyAccess(header.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException({
        message: 'Invalid or expired token',
        code: 'UNAUTHENTICATED',
      });
    }
  }
}
