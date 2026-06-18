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
 * SMS one-time-password lifecycle in Redis (ephemeral by design — no OTP at rest in PG).
 * Code is stored only as a SHA-256 digest; attempts and lockout are tracked with TTL keys so
 * they self-expire. Keyed by the deterministic phone_hash, never the raw phone.
 */
@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisService) {}

  private codeKey(phoneHash: string): string {
    return `otp:code:${phoneHash}`;
  }
  private cooldownKey(phoneHash: string): string {
    return `otp:cooldown:${phoneHash}`;
  }
  private attemptsKey(phoneHash: string): string {
    return `otp:attempts:${phoneHash}`;
  }
  private lockKey(phoneHash: string): string {
    return `otp:lock:${phoneHash}`;
  }

  private static digest(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** Generate + store a fresh OTP. Returns the plaintext code (to hand to the SMS provider). */
  async issue(phoneHash: string): Promise<{ code: string; expiresInSeconds: number }> {
    const cooldownTtl = await this.redis.client.ttl(this.cooldownKey(phoneHash));
    if (cooldownTtl > 0) throw new OtpCooldownError(cooldownTtl);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.client.set(this.codeKey(phoneHash), OtpService.digest(code), 'EX', OTP_TTL_SECONDS);
    await this.redis.client.set(this.cooldownKey(phoneHash), '1', 'EX', OTP_COOLDOWN_SECONDS);
    await this.redis.client.del(this.attemptsKey(phoneHash));
    return { code, expiresInSeconds: OTP_TTL_SECONDS };
  }

  /**
   * Verify a submitted code. Increments the attempt counter on failure and locks the phone for
   * {@link OTP_LOCK_SECONDS} once attempts reach {@link OTP_MAX_ATTEMPTS}. On success all OTP
   * state is cleared.
   */
  async verify(phoneHash: string, code: string): Promise<OtpVerifyResult> {
    if ((await this.redis.client.exists(this.lockKey(phoneHash))) === 1) return 'LOCKED';

    const stored = await this.redis.client.get(this.codeKey(phoneHash));
    if (stored && stored === OtpService.digest(code)) {
      await this.clear(phoneHash);
      return 'OK';
    }

    const attempts = await this.redis.client.incr(this.attemptsKey(phoneHash));
    if (attempts === 1) {
      await this.redis.client.expire(this.attemptsKey(phoneHash), OTP_TTL_SECONDS);
    }
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await this.redis.client.set(this.lockKey(phoneHash), '1', 'EX', OTP_LOCK_SECONDS);
      await this.redis.client.del(this.codeKey(phoneHash), this.attemptsKey(phoneHash));
      return 'LOCKED';
    }
    return 'INVALID';
  }

  /** Live attempt counter (for mirroring into users.verification_attempts). */
  async attempts(phoneHash: string): Promise<number> {
    const n = await this.redis.client.get(this.attemptsKey(phoneHash));
    return n ? Number(n) : 0;
  }

  private async clear(phoneHash: string): Promise<void> {
    await this.redis.client.del(
      this.codeKey(phoneHash),
      this.attemptsKey(phoneHash),
      this.lockKey(phoneHash),
    );
  }
}
