import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthPrincipal } from './principal';
import {
  REQUEST_AUTHENTICATORS,
  type RequestAuthenticator,
} from './request-authenticator';

/**
 * Global authentication guard. Requires an authenticated principal on every route except those
 * marked @Public(). On success attaches the principal to `req.user` (read via @CurrentUser()).
 *
 * ADR-0011 §5: authentication is factored out into an ordered {@link RequestAuthenticator} chain
 * (source-agnostic principal). The guard iterates the chain; the FIRST authenticator that returns a
 * principal wins, otherwise 401. Today the chain is just `BearerJwtAuthenticator`, so behaviour is
 * identical to the previous inline Bearer-only implementation; agents plug in later as one extra
 * link with no guard rewrite. The guard keeps the @Public() opt-out and the req.user contract
 * untouched, so no existing endpoint/decorator (RolesGuard/PoliciesGuard/@CurrentUser) is affected.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REQUEST_AUTHENTICATORS)
    private readonly authenticators: readonly RequestAuthenticator[],
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    for (const authenticator of this.authenticators) {
      const principal = authenticator.tryAuthenticate(req);
      if (principal) {
        req.user = principal;
        return true;
      }
    }
    throw new UnauthorizedException({
      message: 'Missing or invalid credentials',
      code: 'UNAUTHENTICATED',
    });
  }
}
