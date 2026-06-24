import { SetMetadata } from '@nestjs/common';
import type { Role } from './principal';

export const REQUIRED_ROLES_KEY = 'requiredRoles';

/**
 * Coarse role gate (mirrors the `x-required-roles` declaration in the OpenAPI contracts and
 * `rbac-matrix.md`). Enforced by RolesGuard. Object-level ownership is a separate, service-layer
 * check (PoliciesGuard / assertCan). USER-tier roles inherit USER (see roleSatisfies).
 */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);
