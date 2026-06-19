import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  OAuthVerificationError,
  type OAuthIdentity,
  type OAuthProvider,
  type OAuthVerifyInput,
} from './oauth.types';

interface TelegramPayload {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
}

const MAX_AUTH_AGE_SECONDS = 86_400; // reject login payloads older than 1 day

/**
 * Telegram Login Widget verification (no network): the payload is authenticated by an HMAC the
 * bot computes with its token. secret = SHA256(bot_token); valid iff
 * HMAC_SHA256(data_check_string, secret) == payload.hash. Self-contained → fully unit-testable.
 * The client sends the widget object as a JSON string in `code`.
 */
export class TelegramOAuthAdapter implements OAuthProvider {
  readonly name = 'telegram' as const;

  constructor(private readonly botToken: string) {}

  verify(input: OAuthVerifyInput): Promise<OAuthIdentity> {
    // Logic is synchronous (crypto only); wrap so any validation throw surfaces as a rejection.
    return Promise.resolve().then(() => this.check(input));
  }

  private check(input: OAuthVerifyInput): OAuthIdentity {
    let data: TelegramPayload;
    try {
      data = JSON.parse(input.code) as TelegramPayload;
    } catch {
      throw new OAuthVerificationError('telegram payload is not valid JSON');
    }
    if (!data.hash || data.id === undefined || data.auth_date === undefined) {
      throw new OAuthVerificationError('telegram payload missing required fields');
    }

    const checkString = Object.keys(data)
      .filter((k) => k !== 'hash')
      .sort()
      .map((k) => `${k}=${String((data as unknown as Record<string, unknown>)[k])}`)
      .join('\n');

    const secret = createHash('sha256').update(this.botToken).digest();
    const expected = createHmac('sha256', secret).update(checkString).digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(data.hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new OAuthVerificationError('telegram hash mismatch');
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - Number(data.auth_date);
    if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -300) {
      throw new OAuthVerificationError('telegram auth_date is stale');
    }

    const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || null;
    return {
      providerId: String(data.id),
      fullName: fullName ?? data.username ?? null,
      avatarUrl: data.photo_url ?? null,
    };
  }
}
