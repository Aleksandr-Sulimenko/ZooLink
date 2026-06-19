import { Logger } from '@nestjs/common';
import {
  OAuthVerificationError,
  type OAuthIdentity,
  type OAuthProvider,
  type OAuthProviderName,
  type OAuthVerifyInput,
} from './oauth.types';

/**
 * Dev/test OAuth adapter used when a provider has no real credentials configured. It is NEVER
 * selected in production (the registry rejects unconfigured providers there) — a stub that
 * authenticates anybody must not run in prod. The `code` is taken as the external provider id;
 * an optional JSON `code` may carry email/fullName/avatarUrl for richer local testing.
 */
export class StubOAuthProvider implements OAuthProvider {
  private readonly logger = new Logger('StubOAuthProvider');

  constructor(readonly name: OAuthProviderName) {}

  async verify(input: OAuthVerifyInput): Promise<OAuthIdentity> {
    if (!input.code) throw new OAuthVerificationError('missing code');
    this.logger.warn(`[STUB] ${this.name} OAuth accepted code as provider id (dev/test only)`);
    await Promise.resolve();

    if (input.code.startsWith('{')) {
      try {
        const obj = JSON.parse(input.code) as Partial<OAuthIdentity> & { providerId?: string };
        return {
          providerId: obj.providerId ?? `stub-${this.name}-1`,
          email: obj.email ?? null,
          emailVerified: obj.emailVerified ?? false,
          fullName: obj.fullName ?? null,
          avatarUrl: obj.avatarUrl ?? null,
        };
      } catch {
        // fall through to treating code as the raw provider id
      }
    }
    return { providerId: input.code };
  }
}
