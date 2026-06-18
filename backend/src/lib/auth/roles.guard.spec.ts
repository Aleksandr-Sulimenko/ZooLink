import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, roleSatisfies } from './roles.guard';
import type { AuthPrincipal, Role } from './principal';

describe('roleSatisfies', () => {
  it('exact match passes', () => {
    expect(roleSatisfies('MODERATOR', 'MODERATOR')).toBe(true);
  });
  it('USER-tier roles satisfy a USER-only route', () => {
    for (const r of ['USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER'] as Role[]) {
      expect(roleSatisfies(r, 'USER')).toBe(true);
    }
  });
  it('operators do NOT implicitly satisfy a USER route, and vice-versa', () => {
    expect(roleSatisfies('MODERATOR', 'USER')).toBe(false);
    expect(roleSatisfies('USER', 'MODERATOR')).toBe(false);
    expect(roleSatisfies('BREEDER', 'ADMIN')).toBe(false);
  });
});

describe('RolesGuard', () => {
  const ctxWith = (user: AuthPrincipal | undefined) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  const guardWith = (required: Role[] | undefined) => {
    const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  const user = (role: Role): AuthPrincipal => ({ userId: 'u1', role, principalType: 'HUMAN' });

  it('passes when no roles are required', () => {
    expect(guardWith(undefined).canActivate(ctxWith(undefined))).toBe(true);
  });
  it('passes when the principal satisfies a required role (USER inheritance)', () => {
    expect(guardWith(['USER']).canActivate(ctxWith(user('BREEDER')))).toBe(true);
  });
  it('throws Forbidden when the role is insufficient', () => {
    expect(() => guardWith(['ADMIN']).canActivate(ctxWith(user('USER')))).toThrow(ForbiddenException);
  });
  it('throws Forbidden when unauthenticated but roles are required', () => {
    expect(() => guardWith(['USER']).canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });
});
