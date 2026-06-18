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
}

/** Access-token JWT claims (snake_case payload; `sub` is the user id). */
export interface AccessTokenClaims {
  sub: string;
  role: Role;
  principal_type: PrincipalType;
}
