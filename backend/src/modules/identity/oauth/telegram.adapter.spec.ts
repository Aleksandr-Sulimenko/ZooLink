import { createHash, createHmac } from 'node:crypto';
import { TelegramOAuthAdapter } from './telegram.adapter';
import { OAuthVerificationError } from './oauth.types';

const BOT_TOKEN = '123456:test-bot-token';

/** Build a valid Telegram login payload signed with BOT_TOKEN. */
function signedPayload(fields: Record<string, string | number>): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${String(fields[k])}`)
    .join('\n');
  const secret = createHash('sha256').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  return JSON.stringify({ ...fields, hash });
}

describe('TelegramOAuthAdapter', () => {
  const adapter = new TelegramOAuthAdapter(BOT_TOKEN);
  const now = Math.floor(Date.now() / 1000);

  it('verifies a correctly-signed payload and returns the identity', async () => {
    const code = signedPayload({ id: 777, first_name: 'Ann', last_name: 'T', auth_date: now });
    const identity = await adapter.verify({ code });
    expect(identity.providerId).toBe('777');
    expect(identity.fullName).toBe('Ann T');
  });

  it('rejects a forged hash', async () => {
    const code = JSON.stringify({ id: 777, auth_date: now, hash: 'deadbeef' });
    await expect(adapter.verify({ code })).rejects.toBeInstanceOf(OAuthVerificationError);
  });

  it('rejects a payload signed with a different bot token', async () => {
    const other = new TelegramOAuthAdapter('999:other-token');
    const code = signedPayload({ id: 1, auth_date: now });
    await expect(other.verify({ code })).rejects.toBeInstanceOf(OAuthVerificationError);
  });

  it('rejects a stale auth_date', async () => {
    const code = signedPayload({ id: 1, auth_date: now - 100_000 });
    await expect(adapter.verify({ code })).rejects.toBeInstanceOf(OAuthVerificationError);
  });

  it('rejects non-JSON input', async () => {
    await expect(adapter.verify({ code: 'not-json' })).rejects.toBeInstanceOf(OAuthVerificationError);
  });
});
