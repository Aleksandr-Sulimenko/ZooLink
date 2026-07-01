import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Versioned prefix on every ciphertext. The version lets the *primitive* be swapped (e.g. a certified
 * СКЗИ/ГОСТ cipher — ADR-0019 residual investigation) behind this seam without a schema/contract
 * rewrite. Also lets decrypt() detect already-encrypted values (idempotent backfill / mixed-state read).
 */
const ENC_PREFIX = 'enc:v1:';
const IV_BYTES = 12; // AES-GCM standard nonce length
const TAG_BYTES = 16; // AES-GCM auth tag length

/**
 * PII-at-rest crypto seam (ADR-0019, enforcing ADR-0012). Two independent primitives:
 *  - AES-256-GCM field encryption (random IV per write + auth tag) for reversible, sendable PII
 *    (email, contact_phone) — `encrypt`/`decrypt`.
 *  - Deterministic HMAC-SHA256 blind index for *searchable* PII (email equality lookup) — `blindIndex`
 *    / `emailBlindIndex` (mirrors the `phone_hash` precedent, ADR-0011).
 *
 * Keys come from env (`PII_DATA_KEY`, `PII_BLIND_INDEX_KEY`) — the KMS/СКЗИ swap-point is entirely
 * inside this class (ADR-0012 Option-2 "key in SQL" rejected). Defense-in-depth now (OD-2); a formal
 * certified-СКЗИ swap, if приказ ФСТЭК №21 requires it, is a primitive change behind this seam.
 */
@Injectable()
export class CryptoService {
  private readonly dataKey: Buffer; // 32 bytes → AES-256
  private readonly blindIndexKey: string;

  constructor(config: AppConfigService) {
    // Derive a uniform 256-bit AES key from the configured secret. The secret is ≥32 chars and
    // high-entropy (env-validated); SHA-256 maps it to exactly 32 bytes for AES-256.
    this.dataKey = createHash('sha256').update(config.get('PII_DATA_KEY')).digest();
    this.blindIndexKey = config.get('PII_BLIND_INDEX_KEY');
  }

  /**
   * AES-256-GCM encrypt. `null`/`undefined` → `null` (so nullable columns round-trip untouched).
   * Returns `enc:v1:` + base64url(iv | tag | ciphertext).
   */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined) return null;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64url');
  }

  /**
   * AES-256-GCM decrypt. `null` → `null`. A value WITHOUT the `enc:v1:` prefix is treated as legacy
   * plaintext and returned as-is — this keeps reads correct during the rollout/backfill window
   * (mixed encrypted + not-yet-backfilled rows). GCM auth-tag verification throws on tamper.
   */
  decrypt(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (!value.startsWith(ENC_PREFIX)) return value; // legacy plaintext passthrough (rollout-safe)
    const raw = Buffer.from(value.slice(ENC_PREFIX.length), 'base64url');
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.dataKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** True iff the value is one of this seam's ciphertexts (used by the idempotent backfill). */
  isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(ENC_PREFIX);
  }

  /**
   * Deterministic HMAC-SHA256 blind index for equality lookups over encrypted PII (phone_hash
   * precedent, ADR-0011). Same value in → same index out, so a UNIQUE/equality lookup still works
   * without ever exposing plaintext. base64url (43 chars) — fits VARCHAR(60).
   */
  blindIndex(value: string): string {
    return createHmac('sha256', this.blindIndexKey).update(value).digest('base64url');
  }

  /**
   * Blind index for the account email. Normalises (trim + lowercase) FIRST so lookup is
   * case/whitespace-insensitive and consistent on every write and read path (recovery, admin search).
   */
  emailBlindIndex(rawEmail: string): string {
    return this.blindIndex(rawEmail.trim().toLowerCase());
  }
}
