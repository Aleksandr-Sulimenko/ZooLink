import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../../modules/auth/token.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthPrincipal } from './principal';

/**
 * Global authentication guard. Requires a valid Bearer access token on every route except those
 * marked @Public(). On success attaches the principal to `req.user` (read via @CurrentUser()).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ message: 'Missing bearer token', code: 'UNAUTHENTICATED' });
    }
    try {
      req.user = this.tokens.verifyAccess(header.slice('Bearer '.length));
      return true;
    } catch {
      throw new UnauthorizedException({ message: 'Invalid or expired token', code: 'UNAUTHENTICATED' });
    }
  }
}
