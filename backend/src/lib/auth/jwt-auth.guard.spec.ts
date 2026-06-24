import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { BearerJwtAuthenticator } from './bearer-jwt.authenticator';
import { AgentServiceTokenAuthenticator } from './agent-service-token.authenticator';
import type { AuthPrincipal } from './principal';
import type { RequestAuthenticator } from './request-authenticator';
import type { TokenService } from '../../modules/auth/token.service';

const PRINCIPAL: AuthPrincipal = { userId: 'u1', role: 'USER', principalType: 'HUMAN' };

const ctxWith = (req: { headers?: Record<string, unknown>; user?: AuthPrincipal }, isPublic = false) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
    __isPublic: isPublic,
  }) as unknown as ExecutionContext;

const guardWith = (authenticators: RequestAuthenticator[], isPublic = false) => {
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  return new JwtAuthGuard(reflector, authenticators);
};

describe('JwtAuthGuard (authenticator chain — ADR-0011 §5)', () => {
  it('passes @Public() routes without consulting the chain', () => {
    const never: RequestAuthenticator = {
      tryAuthenticate: () => {
        throw new Error('should not be called');
      },
    };
    expect(guardWith([never], true).canActivate(ctxWith({ headers: {} }))).toBe(true);
  });

  it('attaches the principal from the first authenticator that returns one', () => {
    const ok: RequestAuthenticator = { tryAuthenticate: () => PRINCIPAL };
    const req: { headers: Record<string, unknown>; user?: AuthPrincipal } = { headers: {} };
    expect(guardWith([ok]).canActivate(ctxWith(req))).toBe(true);
    expect(req.user).toEqual(PRINCIPAL);
  });

  it('first non-null principal wins; later links are not consulted', () => {
    const second = jest.fn().mockReturnValue({ ...PRINCIPAL, userId: 'u2' });
    const ok: RequestAuthenticator = { tryAuthenticate: () => PRINCIPAL };
    const next: RequestAuthenticator = { tryAuthenticate: second };
    const req: { headers: Record<string, unknown>; user?: AuthPrincipal } = { headers: {} };
    guardWith([ok, next]).canActivate(ctxWith(req));
    expect(req.user).toEqual(PRINCIPAL);
    expect(second).not.toHaveBeenCalled();
  });

  it('falls through to the next link when an earlier one returns null', () => {
    const skip: RequestAuthenticator = { tryAuthenticate: () => null };
    const ok: RequestAuthenticator = { tryAuthenticate: () => PRINCIPAL };
    const req: { headers: Record<string, unknown>; user?: AuthPrincipal } = { headers: {} };
    expect(guardWith([skip, ok]).canActivate(ctxWith(req))).toBe(true);
    expect(req.user).toEqual(PRINCIPAL);
  });

  it('throws 401 when no authenticator yields a principal', () => {
    const skip: RequestAuthenticator = { tryAuthenticate: () => null };
    expect(() => guardWith([skip]).canActivate(ctxWith({ headers: {} }))).toThrow(
      UnauthorizedException,
    );
  });

  it('propagates a thrown 401 from an authenticator (bad credential that IS theirs)', () => {
    const bad: RequestAuthenticator = {
      tryAuthenticate: () => {
        throw new UnauthorizedException();
      },
    };
    expect(() => guardWith([bad]).canActivate(ctxWith({ headers: {} }))).toThrow(
      UnauthorizedException,
    );
  });
});

describe('BearerJwtAuthenticator (behaviour-preserving extraction)', () => {
  const tokensWith = (impl: (t: string) => AuthPrincipal) =>
    ({ verifyAccess: jest.fn(impl) }) as unknown as TokenService;

  it('returns null when no Bearer header is present (credential absent)', () => {
    const auth = new BearerJwtAuthenticator(tokensWith(() => PRINCIPAL));
    expect(auth.tryAuthenticate({ headers: {} } as never)).toBeNull();
  });

  it('returns null for a non-Bearer Authorization header', () => {
    const auth = new BearerJwtAuthenticator(tokensWith(() => PRINCIPAL));
    expect(auth.tryAuthenticate({ headers: { authorization: 'Basic xyz' } } as never)).toBeNull();
  });

  it('returns the verified principal for a valid Bearer token', () => {
    const auth = new BearerJwtAuthenticator(tokensWith(() => PRINCIPAL));
    expect(auth.tryAuthenticate({ headers: { authorization: 'Bearer good' } } as never)).toEqual(
      PRINCIPAL,
    );
  });

  it('throws 401 for a present-but-invalid Bearer token', () => {
    const auth = new BearerJwtAuthenticator(
      tokensWith(() => {
        throw new Error('bad signature');
      }),
    );
    expect(() => auth.tryAuthenticate({ headers: { authorization: 'Bearer bad' } } as never)).toThrow(
      UnauthorizedException,
    );
  });
});

describe('AgentServiceTokenAuthenticator (gated stub — ADR-0011 §5, behaviour OFF in MVP)', () => {
  it('always returns null while the AGENT gate is off (form only)', () => {
    const auth = new AgentServiceTokenAuthenticator();
    expect(auth.tryAuthenticate({ headers: { 'x-agent-token': 'whatever' } } as never)).toBeNull();
    expect(auth.tryAuthenticate({ headers: {} } as never)).toBeNull();
  });
});
