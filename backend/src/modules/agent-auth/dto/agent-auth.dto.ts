import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Body for `POST /v1/admin/agents/{agentUserId}/credentials` (ADR-0036 §2) — issue a credential for an
 * existing AGENT account. All fields optional: a bare issuance mints a deny-by-default credential
 * (no profile ⇒ no scope) that never expires until rotated/revoked.
 */
export class IssueCredentialDto {
  /** Human-readable purpose label (operability only; not authority). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  /** ADR-0037: the named least-privilege scope profile this credential resolves to. NULL = deny-by-default. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  capabilityProfileId?: number;

  /** ADR-0036 §7: optional auto-expiry (ISO-8601). Omit for no expiry (form now; ~90d default at activation). */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/**
 * Body for `POST /v1/admin/agents/{agentUserId}/credentials/{credId}/rotate` (ADR-0036 §4). The new
 * credential inherits the old one's agent + profile unless overridden here; the OLD credential is NOT
 * auto-revoked (overlap window — revoke it separately once the agent has swapped).
 */
export class RotateCredentialDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  capabilityProfileId?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/** Body for `POST /v1/auth/agent/token` (ADR-0036 §1) — the raw `zlk_agent_<credId>_<secret>` credential. */
export class AgentTokenExchangeDto {
  @IsString()
  @IsNotEmpty()
  credential!: string;
}

/**
 * Issuance/rotation response — the plaintext secret is returned EXACTLY ONCE (never retrievable again;
 * only `secret_hash` persists). The caller MUST capture `secret` here.
 */
export interface CredentialIssuedView {
  id: string;
  agentUserId: string;
  /** The full `zlk_agent_<credId>_<secret>` token — shown ONCE. */
  secret: string;
  capabilityProfileId: number | null;
  expiresAt: string | null;
  rotatedFrom: string | null;
  createdAt: string;
}

/** Exchange response — a short-lived AGENT access token (no refresh token is issued to an agent). */
export interface AgentAccessTokenView {
  accessToken: string;
  tokenType: 'Bearer';
}
