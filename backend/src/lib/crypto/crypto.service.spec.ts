import { CryptoService } from './crypto.service';
import type { AppConfigService } from '../../config/app-config.service';

function makeCrypto(overrides: Record<string, string> = {}): CryptoService {
  const env: Record<string, string> = {
    PII_DATA_KEY: 'test_pii_data_key_0000000000000000000000',
    PII_BLIND_INDEX_KEY: 'test_pii_bidx_key_0000000000000000000000',
    ...overrides,
  };
  return new CryptoService({ get: (k: string) => env[k] } as unknown as AppConfigService);
}

describe('CryptoService.encrypt/decrypt (AES-256-GCM)', () => {
  const crypto = makeCrypto();

  it('round-trips a plaintext value', () => {
    const ct = crypto.encrypt('ann@example.com');
    expect(ct).not.toBeNull();
    expect(ct).toMatch(/^enc:v1:/);
    expect(ct).not.toContain('ann@example.com');
    expect(crypto.decrypt(ct)).toBe('ann@example.com');
  });

  it('is non-deterministic (random IV per write) yet both decrypt to the same value', () => {
    const a = crypto.encrypt('same@example.com');
    const b = crypto.encrypt('same@example.com');
    expect(a).not.toBe(b); // different IV → different ciphertext
    expect(crypto.decrypt(a)).toBe('same@example.com');
    expect(crypto.decrypt(b)).toBe('same@example.com');
  });

  it('maps null/undefined to null on both directions', () => {
    expect(crypto.encrypt(null)).toBeNull();
    expect(crypto.encrypt(undefined)).toBeNull();
    expect(crypto.decrypt(null)).toBeNull();
    expect(crypto.decrypt(undefined)).toBeNull();
  });

  it('passes through legacy (non-prefixed) plaintext on decrypt — rollout-safe', () => {
    expect(crypto.decrypt('legacy-plaintext@example.com')).toBe('legacy-plaintext@example.com');
  });

  it('reports isEncrypted only for its own ciphertext', () => {
    expect(crypto.isEncrypted(crypto.encrypt('x'))).toBe(true);
    expect(crypto.isEncrypted('x')).toBe(false);
    expect(crypto.isEncrypted(null)).toBe(false);
  });

  it('throws on a tampered ciphertext (GCM auth-tag verification)', () => {
    const ct = crypto.encrypt('secret')!;
    const tampered = ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('cannot decrypt with a different data key', () => {
    const ct = crypto.encrypt('secret')!;
    const other = makeCrypto({ PII_DATA_KEY: 'a_completely_different_key_0000000000000' });
    expect(() => other.decrypt(ct)).toThrow();
  });
});

describe('CryptoService.blindIndex / emailBlindIndex', () => {
  const crypto = makeCrypto();

  it('is deterministic for the same input', () => {
    expect(crypto.blindIndex('value')).toBe(crypto.blindIndex('value'));
  });

  it('differs for different inputs and for a different key', () => {
    expect(crypto.blindIndex('a')).not.toBe(crypto.blindIndex('b'));
    const other = makeCrypto({ PII_BLIND_INDEX_KEY: 'another_bidx_key_00000000000000000000000' });
    expect(other.blindIndex('a')).not.toBe(crypto.blindIndex('a'));
  });

  it('normalises the email (trim + lowercase) so lookup is case/whitespace-insensitive', () => {
    const canonical = crypto.emailBlindIndex('ann@example.com');
    expect(crypto.emailBlindIndex('  Ann@Example.COM ')).toBe(canonical);
    expect(crypto.emailBlindIndex('ANN@EXAMPLE.COM')).toBe(canonical);
  });

  it('fits VARCHAR(60) (43-char base64url)', () => {
    expect(crypto.emailBlindIndex('ann@example.com')).toHaveLength(43);
  });
});

describe('CryptoService.agentCredentialHash / safeEqual (ADR-0036 §3.2/§3.3)', () => {
  const crypto = makeCrypto({ AGENT_SERVICE_SIGNING_SECRET: 'agent_signing_secret_0000000000000000000' });

  it('is deterministic for the same secret and keyed (43-char base64url, fits VARCHAR(255))', () => {
    const h = crypto.agentCredentialHash('super-secret');
    expect(h).toBe(crypto.agentCredentialHash('super-secret'));
    expect(h).toHaveLength(43);
  });

  it('differs for a different secret and for a different signing key', () => {
    expect(crypto.agentCredentialHash('a')).not.toBe(crypto.agentCredentialHash('b'));
    const other = makeCrypto({ AGENT_SERVICE_SIGNING_SECRET: 'another_agent_signing_secret_00000000000' });
    expect(other.agentCredentialHash('a')).not.toBe(crypto.agentCredentialHash('a'));
  });

  it('fails closed when the signing secret is not configured', () => {
    const noKey = makeCrypto(); // no AGENT_SERVICE_SIGNING_SECRET
    expect(() => noKey.agentCredentialHash('x')).toThrow(/AGENT_SERVICE_SIGNING_SECRET/);
  });

  it('safeEqual is true for equal strings, false otherwise (incl. length mismatch)', () => {
    expect(crypto.safeEqual('abc', 'abc')).toBe(true);
    expect(crypto.safeEqual('abc', 'abd')).toBe(false);
    expect(crypto.safeEqual('abc', 'abcd')).toBe(false);
    expect(crypto.safeEqual('', '')).toBe(true);
  });
});
