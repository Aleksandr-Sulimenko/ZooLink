/** OAuth providers (ADR-0008). Names match the users.oauth_<name>_id columns. */
export const OAUTH_PROVIDERS = ['google', 'apple', 'telegram', 'vk'] as const;
export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string): value is OAuthProviderName {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Raw client-supplied credential to verify with the provider. */
export interface OAuthVerifyInput {
  /** Authorization code / id_token / signed login payload, per provider. */
  code: string;
}

/** Normalised identity returned by a provider after successful verification. */
export interface OAuthIdentity {
  /** Stable external user id → stored in users.oauth_<provider>_id. */
  providerId: string;
  email?: string | null;
  emailVerified?: boolean;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface OAuthProvider {
  readonly name: OAuthProviderName;
  verify(input: OAuthVerifyInput): Promise<OAuthIdentity>;
}

/** Verification failed (bad/forged/expired credential) → maps to 401. */
export class OAuthVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthVerificationError';
  }
}
