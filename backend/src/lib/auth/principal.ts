import type { ScopeGrant } from './scope';

/** Canonical role set — must match the DB CHECK on users.role (spec 01, identity domain). */
export type Role =
  | 'USER'
  | 'MODERATOR'
  | 'ADMIN'
  | 'BREEDER'
  | 'FARMER'
  | 'VETERINARIAN'
  | 'GROOMER';

/** Principal type — a principal may be a human or an AI agent (ADR-0006). */
export type PrincipalType = 'HUMAN' | 'AGENT';

/** The authenticated actor attached to a request after JwtAuthGuard succeeds. */
export interface AuthPrincipal {
  userId: string;
  role: Role;
  principalType: PrincipalType;
  /**
   * ADR-0037 least-privilege scope. Populated for AGENT principals ONLY (from the credential's
   * capability profile, resolved at token exchange). `undefined` for HUMAN principals ⇒ the full
   * role matrix (byte-identical to pre-ADR). An AGENT with undefined/empty scope = deny-by-default.
   */
  scope?: ScopeGrant[];
}

/** Access-token JWT claims (snake_case payload; `sub` is the user id). */
export interface AccessTokenClaims {
  sub: string;
  role: Role;
  principal_type: PrincipalType;
  /** ADR-0037 scope claim — present only on AGENT access tokens (absent for HUMAN tokens). */
  scope?: ScopeGrant[];
}
