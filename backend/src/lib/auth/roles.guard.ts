import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_ROLES_KEY } from './roles.decorator';
import type { AuthPrincipal, Role } from './principal';

/** USER-tier roles inherit all USER permissions (rbac-matrix.md). Operators stand alone. */
const USER_TIER: ReadonlySet<Role> = new Set<Role>([
  'USER',
  'BREEDER',
  'FARMER',
  'VETERINARIAN',
  'GROOMER',
]);

/** True if `actual` satisfies a route that requires `required`. */
export function roleSatisfies(actual: Role, required: Role): boolean {
  if (actual === required) return true;
  // A USER-tier role satisfies a route that only requires the base USER role.
  return required === 'USER' && USER_TIER.has(actual);
}

/**
 * Global coarse role gate. No @Roles() on the route → pass (default behavior; ownership/policy
 * checks happen elsewhere). With @Roles(), the principal's role must satisfy at least one.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    const role = req.user?.role;
    if (!role || !required.some((r) => roleSatisfies(role, r))) {
      throw new ForbiddenException({ message: 'Insufficient role', code: 'FORBIDDEN' });
    }
    return true;
  }
}
