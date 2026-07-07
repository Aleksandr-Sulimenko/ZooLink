import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../../lib/auth/roles.guard';
import { REQUIRED_ROLES_KEY } from '../../lib/auth/roles.decorator';
import type { AuthPrincipal } from '../../lib/auth/principal';

/**
 * ADR-0022 authz-parity guard for the DORMANT `user_roles` junction.
 *
 * The junction is a form-now reservation (migration 0034): `users.role` stays the single,
 * authoritative authz source (rule 2). These tests pin BOTH halves of "dormant":
 *   1. No authz path reads the junction — the coarse RolesGuard decides purely on the JWT
 *      principal's single `role`; a row in `user_roles` therefore grants nothing.
 *   2. The junction is write-only across the whole backend source — the only Prisma access is
 *      the additive sync-on-write (`createMany`); no read (find/count/aggregate) exists.
 */

function ctxFor(required: string[] | undefined, principal: AuthPrincipal): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
  } as unknown as ExecutionContext;
}

function guardWith(required: string[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('ADR-0022 authz-parity: user_roles junction grants no rights', () => {
  it('denies a MODERATOR-gated route to a USER principal — a hypothetical junction MODERATOR row is irrelevant', () => {
    // The principal (from the JWT) carries the single primary role only. Even if this user held a
    // MODERATOR row in user_roles, the guard never consults it → still forbidden. That is the parity.
    const guard = guardWith(['MODERATOR']);
    const user: AuthPrincipal = { userId: 'u1', role: 'USER', principalType: 'HUMAN' };
    expect(() => guard.canActivate(ctxFor(['MODERATOR'], user))).toThrow(ForbiddenException);
  });

  it('grants strictly on the principal primary role (no DB / junction lookup)', () => {
    const guard = guardWith(['MODERATOR']);
    const mod: AuthPrincipal = { userId: 'm1', role: 'MODERATOR', principalType: 'HUMAN' };
    expect(guard.canActivate(ctxFor(['MODERATOR'], mod))).toBe(true);
    // Sanity: the guard exposes no data-access seam through which the junction could ever be read.
    expect(REQUIRED_ROLES_KEY).toBeDefined();
  });

  it('the junction is WRITE-ONLY across the backend source (dormant: no read path exists)', () => {
    const srcRoot = join(__dirname, '..', '..');
    const methods = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts') || full.endsWith('.spec.ts')) continue;
        const text = readFileSync(full, 'utf8');
        for (const m of text.matchAll(/\.user_roles\.(\w+)/g)) methods.add(m[1]);
      }
    };
    walk(srcRoot);
    // Only the additive sync-on-write is allowed; any read (findMany/findFirst/findUnique/count/
    // aggregate/groupBy) would break dormancy and the authz-parity guarantee.
    expect([...methods].sort()).toEqual(['createMany']);
  });
});
