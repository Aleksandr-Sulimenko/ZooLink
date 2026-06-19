import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../lib/redis/redis.service';

export const OTP_TTL_SECONDS = 300; // 5 min
export const OTP_COOLDOWN_SECONDS = 60; // resend cooldown
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_SECONDS = 900; // 15 min lockout after MAX attempts

export type OtpVerifyResult = 'OK' | 'INVALID' | 'LOCKED';

/** Thrown by {@link OtpService.issue} when a resend is requested inside the cooldown window. */
export class OtpCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('OTP resend is on cooldown');
    this.name = 'OtpCooldownError';
  }
}

/**
 * One-time-password lifecycle in Redis (ephemeral by design — no OTP at rest in PG).
 * Code is stored only as a SHA-256 digest; attempts and lockout are tracked with TTL keys so
 * they self-expire. The `subject` is an opaque, already-hashed identifier — the deterministic
 * `phone_hash` for SMS registration, or a keyed digest of the email for account recovery — never
 * the raw phone/email. The `namespace` isolates flows so a registration OTP and a recovery OTP for
 * the same person never collide (default `otp` keeps the phone-registration keys unchanged).
 */
@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisService) {}

  private codeKey(subject: string, ns: string): string {
    return `${ns}:code:${subject}`;
  }
  private cooldownKey(subject: string, ns: string): string {
    return `${ns}:cooldown:${subject}`;
  }
  private attemptsKey(subject: string, ns: string): string {
    return `${ns}:attempts:${subject}`;
  }
  private lockKey(subject: string, ns: string): string {
    return `${ns}:lock:${subject}`;
  }

  private static digest(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** Generate + store a fresh OTP. Returns the plaintext code (to hand to the SMS/email provider). */
  async issue(subject: string, ns = 'otp'): Promise<{ code: string; expiresInSeconds: number }> {
    const cooldownTtl = await this.redis.client.ttl(this.cooldownKey(subject, ns));
    if (cooldownTtl > 0) throw new OtpCooldownError(cooldownTtl);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.client.set(this.codeKey(subject, ns), OtpService.digest(code), 'EX', OTP_TTL_SECONDS);
    await this.redis.client.set(this.cooldownKey(subject, ns), '1', 'EX', OTP_COOLDOWN_SECONDS);
    await this.redis.client.del(this.attemptsKey(subject, ns));
    return { code, expiresInSeconds: OTP_TTL_SECONDS };
  }

  /**
   * Verify a submitted code. Increments the attempt counter on failure and locks the subject for
   * {@link OTP_LOCK_SECONDS} once attempts reach {@link OTP_MAX_ATTEMPTS}. On success all OTP
   * state is cleared.
   */
  async verify(subject: string, code: string, ns = 'otp'): Promise<OtpVerifyResult> {
    if ((await this.redis.client.exists(this.lockKey(subject, ns))) === 1) return 'LOCKED';

    const stored = await this.redis.client.get(this.codeKey(subject, ns));
    if (stored && stored === OtpService.digest(code)) {
      await this.clear(subject, ns);
      return 'OK';
    }

    const attempts = await this.redis.client.incr(this.attemptsKey(subject, ns));
    if (attempts === 1) {
      await this.redis.client.expire(this.attemptsKey(subject, ns), OTP_TTL_SECONDS);
    }
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await this.redis.client.set(this.lockKey(subject, ns), '1', 'EX', OTP_LOCK_SECONDS);
      await this.redis.client.del(this.codeKey(subject, ns), this.attemptsKey(subject, ns));
      return 'LOCKED';
    }
    return 'INVALID';
  }

  /** Live attempt counter (for mirroring into users.verification_attempts). */
  async attempts(subject: string, ns = 'otp'): Promise<number> {
    const n = await this.redis.client.get(this.attemptsKey(subject, ns));
    return n ? Number(n) : 0;
  }

  private async clear(subject: string, ns: string): Promise<void> {
    await this.redis.client.del(
      this.codeKey(subject, ns),
      this.attemptsKey(subject, ns),
      this.lockKey(subject, ns),
    );
  }
}
