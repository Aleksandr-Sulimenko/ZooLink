import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AbilityFactory, type AppAbility } from './ability.factory';
import type { AuthPrincipal } from './principal';

/** A policy handler asserts something about the principal's ability for this route. */
export type PolicyHandler = (ability: AppAbility) => boolean;

export const CHECK_POLICIES_KEY = 'checkPolicies';

/** Attach route-level CASL policy checks, e.g. @CheckPolicies((a) => a.can('read', 'ModerationQueue')). */
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);

/**
 * Global policy gate. No @CheckPolicies() → pass. Otherwise builds the principal's ability and
 * requires every handler to return true. Type-level checks live here; object-level (ownership)
 * checks happen at the service layer via {@link assertCan} once the row is loaded.
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const handlers = this.reflector.getAllAndOverride<PolicyHandler[] | undefined>(
      CHECK_POLICIES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!handlers || handlers.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    if (!req.user) {
      throw new ForbiddenException({ message: 'Not authorized', code: 'FORBIDDEN' });
    }
    const ability = this.abilityFactory.createForPrincipal(req.user);
    if (!handlers.every((h) => h(ability))) {
      throw new ForbiddenException({ message: 'Policy check failed', code: 'FORBIDDEN' });
    }
    return true;
  }
}

/**
 * Service-layer object-level check (defense in depth, rbac-matrix.md). Pass the loaded row tagged
 * with casl `subject()`, e.g. assertCan(ability, 'update', subject('Animal', row)).
 */
export function assertCan(ability: AppAbility, ...args: Parameters<AppAbility['can']>): void {
  if (!ability.can(...args)) {
    throw new ForbiddenException({ message: 'Operation not permitted', code: 'FORBIDDEN' });
  }
}
