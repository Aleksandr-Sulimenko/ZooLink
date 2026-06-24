import { createHmac } from 'node:crypto';

/**
 * Normalise a phone number to E.164-ish canonical form: keep a single leading "+" and digits.
 * Throws on anything that can't be a valid international number (spec 01: E.164).
 */
export function normalizePhone(raw: string): string {
  const digits = raw.trim().replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) {
    throw new Error('invalid phone number');
  }
  return `+${digits}`;
}

/**
 * Deterministic phone hash for unique lookup (spec 01 round-4): HMAC-SHA256(phone, pepper).
 * Returned base64url (43 chars) — fits users.phone_hash VARCHAR(60); a hex digest (64) would not.
 * NOT bcrypt: a per-row salt would defeat uniqueness/lookup.
 */
export function phoneHash(phoneE164: string, pepper: string): string {
  return createHmac('sha256', pepper).update(phoneE164).digest('base64url');
}
