import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../lib/redis/redis.service';

/** TTL of a minted transfer claim code (transfers-api.yaml / C5: now + 15m). */
export const CLAIM_CODE_TTL_SECONDS = 900;
/** Number of Crockford-base32 symbols in a code (16 × 5 bits = 80 bits of entropy, > the ~64-bit floor). */
const CODE_SYMBOLS = 16;
/**
 * Crockford base32 alphabet — the digits I, L, O, U are deliberately absent to avoid transcription
 * ambiguity when a human reads the code aloud / re-types it. Used both to render and (via the
 * normalisation map below) to accept human-entered codes.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Atomic get-then-delete (single-use consume) — one indivisible EVAL, portable across Redis 6.0+. */
const GETDEL_LUA = "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v";

/** Which side a redeemed code resolves to (C5 ClaimCode.recipientType). */
export type ClaimRecipientType = 'USER' | 'ORGANIZATION';

/** The recipient a stored claim code resolves to (exactly one of the two ids is set). */
export interface ClaimRecipient {
  recipientUserId?: string;
  recipientOrganizationId?: string;
}

interface MintedClaimCode {
  code: string;
  expiresInSeconds: number;
  recipientType: ClaimRecipientType;
}

/**
 * Transfer claim-code store (C5, transfers-api.yaml / ownership_transfer_state_machine.md §Safe
 * counterparty resolution). The **recipient** mints a single-use, high-entropy code and shares it
 * out-of-band; the initiator redeems it on `POST /animals/{id}/transfers`.
 *
 * Reuses the proven **namespace-parameterised OTP lifecycle convention** (ns=`transfer:claim`,
 * Redis-only, ephemeral, no plaintext at rest) — but with the *inverse* key shape: the code is the
 * high-entropy **lookup key** and the value is the resolved recipient, so it cannot literally share
 * `OtpService` (subject→digest). Kept in the transfer domain to honour the slice's file discipline
 * (no identity-module edit) while preserving one canonical claim-code lifecycle.
 *
 * No-enumeration (INV-C5-1/6): the code is per-issuance (never per-identity), so a guessed code
 * reveals nothing about who exists; redemption is a single atomic `GETDEL` (single-use) whose every
 * failure mode — nonexistent / expired / already-consumed / malformed — is an indistinguishable
 * miss (the caller maps it to one uniform 422).
 */
@Injectable()
export class ClaimCodeService {
  constructor(private readonly redis: RedisService) {}

  private key(normalizedCode: string): string {
    return `transfer:claim:code:${normalizedCode}`;
  }

  /**
   * Mint a fresh single-use claim code for `recipient`, store `code → recipient` with a 15m TTL, and
   * return the plaintext code ONCE (never retrievable again — only its lookup key is stored).
   */
  async mint(recipient: ClaimRecipient): Promise<MintedClaimCode> {
    const display = this.generateCode();
    const normalized = ClaimCodeService.normalize(display);
    await this.redis.client.set(
      this.key(normalized),
      JSON.stringify(recipient),
      'EX',
      CLAIM_CODE_TTL_SECONDS,
    );
    return {
      code: display,
      expiresInSeconds: CLAIM_CODE_TTL_SECONDS,
      recipientType: recipient.recipientOrganizationId ? 'ORGANIZATION' : 'USER',
    };
  }

  /**
   * Atomically consume a claim code (single-use, INV-C5-6). Returns the resolved recipient, or `null`
   * for EVERY failure mode (nonexistent / expired / already-consumed / malformed) — the caller MUST
   * map a `null` to one uniform 422 `TRANSFER_CLAIM_CODE_INVALID` (INV-C5-1, no existence oracle).
   */
  async consume(rawCode: string): Promise<ClaimRecipient | null> {
    const normalized = ClaimCodeService.normalize(rawCode);
    if (!normalized) return null; // malformed / empty → uniform miss
    // Atomic GET-then-DEL via a Lua script: the whole EVAL runs as one indivisible Redis op, so two
    // concurrent redemptions of the same code cannot both win (single-winner single-use, INV-C5-6).
    // Preferred over GETDEL because GETDEL needs Redis 6.2+ while dev/e2e runs against host Redis 6.0.
    const stored = (await this.redis.client.eval(GETDEL_LUA, 1, this.key(normalized))) as string | null;
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as ClaimRecipient;
      if (parsed.recipientUserId || parsed.recipientOrganizationId) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  /** Generate a display-formatted high-entropy code, e.g. `T7Q4-9KJ2-M3XZ-1H5P` (Crockford base32). */
  private generateCode(): string {
    let out = '';
    for (let i = 0; i < CODE_SYMBOLS; i++) {
      if (i > 0 && i % 4 === 0) out += '-';
      out += CROCKFORD[randomInt(0, CROCKFORD.length)];
    }
    return out;
  }

  /**
   * Normalise a human-entered code to its canonical storage form: strip separators/whitespace,
   * uppercase, and fold the Crockford-ambiguous glyphs (I/L→1, O→0). Any character outside the
   * alphabet after folding makes it a non-code → empty string (a uniform miss).
   */
  static normalize(raw: string): string {
    if (typeof raw !== 'string') return '';
    const folded = raw
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .replace(/[ILO]/g, (c) => (c === 'O' ? '0' : '1'));
    for (const ch of folded) {
      if (!CROCKFORD.includes(ch)) return '';
    }
    return folded;
  }
}
