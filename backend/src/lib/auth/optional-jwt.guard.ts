import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../../modules/auth/token.service';
import type { AuthPrincipal } from './principal';

/**
 * Soft authentication for @Public() routes that still want to know *who* is calling when a token is
 * present (e.g. a public list whose ADMIN caller may opt into extra data). Never throws: a missing or
 * invalid token simply leaves `req.user` unset and the request proceeds as anonymous.
 *
 * Apply per route with `@UseGuards(OptionalJwtGuard)` IN ADDITION to `@Public()` (which keeps the
 * global JwtAuthGuard from rejecting the call).
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        req.user = this.tokens.verifyAccess(header.slice('Bearer '.length));
      } catch {
        // ignore — proceed as anonymous
      }
    }
    return true;
  }
}
