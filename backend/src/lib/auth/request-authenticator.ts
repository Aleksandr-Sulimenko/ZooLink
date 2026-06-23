import type { Request } from 'express';
import type { AuthPrincipal } from './principal';

/**
 * ADR-0011 §5 — source-agnostic authentication.
 *
 * A `RequestAuthenticator` resolves a request into a single {@link AuthPrincipal} abstraction,
 * regardless of *how* the request authenticated. The guard ({@link JwtAuthGuard}) iterates an
 * ordered chain of these; the first one that returns a non-null principal wins, otherwise the
 * request is unauthenticated (401).
 *
 * Authenticators are link in a chain — they MUST NOT throw on a credential that simply isn't theirs
 * (return `null` so the next link can try). Returning `null` means "not my credential / not present";
 * a malformed credential that IS theirs may throw (mapped to 401 by the guard).
 *
 * Today the chain holds only {@link BearerJwtAuthenticator} (human end-users + operators via
 * phone-OTP/OAuth JWT). `AgentServiceTokenAuthenticator` slots in additively later behind the AGENT
 * gate (ADR-0006 phased autonomy P-A…P-D), returning the same principal shape — so adding agents is
 * one extra link, not a guard/authz rewrite.
 */
export interface RequestAuthenticator {
  /**
   * Attempt to authenticate the request from this authenticator's credential source.
   * @returns the resolved principal, or `null` if this authenticator's credential is absent.
   * @throws if a credential that belongs to this authenticator is present but invalid.
   */
  tryAuthenticate(req: Request): AuthPrincipal | null;
}

/** DI token for the ordered authenticator chain consumed by the guard. */
export const REQUEST_AUTHENTICATORS = Symbol('REQUEST_AUTHENTICATORS');
