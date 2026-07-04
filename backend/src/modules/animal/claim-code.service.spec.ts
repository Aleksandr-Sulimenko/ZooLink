import { ClaimCodeService, CLAIM_CODE_TTL_SECONDS } from './claim-code.service';
import type { RedisService } from '../../lib/redis/redis.service';

function setup(getdelValue: string | null = null) {
  const store = new Map<string, string>();
  const set = jest.fn().mockImplementation((key: string, val: string) => {
    store.set(key, val);
    return Promise.resolve('OK');
  });
  // The service consumes via an atomic Lua EVAL (GET+DEL); the mock emulates that key semantics.
  const evalFn = jest.fn().mockImplementation((_script: string, _numKeys: number, key: string) => {
    if (getdelValue !== null) return Promise.resolve(getdelValue);
    const v = store.get(key) ?? null;
    store.delete(key);
    return Promise.resolve(v);
  });
  const redis = { client: { set, eval: evalFn } } as unknown as RedisService;
  return { svc: new ClaimCodeService(redis), set, evalFn, store };
}

describe('ClaimCodeService', () => {
  describe('normalize', () => {
    it('uppercases, strips hyphens/space, folds Crockford I/L→1 O→0', () => {
      expect(ClaimCodeService.normalize('t7q4-9kj2')).toBe('T7Q49KJ2');
      expect(ClaimCodeService.normalize('io l')).toBe('101'); // I→1, O→0, L→1
    });
    it('rejects out-of-alphabet input as an empty (uniform-miss) string', () => {
      expect(ClaimCodeService.normalize('!!!')).toBe('');
      expect(ClaimCodeService.normalize('')).toBe('');
    });
  });

  describe('mint', () => {
    it('stores code→recipient with the 15m TTL and returns the plaintext code once', async () => {
      const { svc, set } = setup();
      const res = await svc.mint({ recipientUserId: 'u1' });
      expect(res.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
      expect(res.recipientType).toBe('USER');
      expect(res.expiresInSeconds).toBe(CLAIM_CODE_TTL_SECONDS);
      expect(set).toHaveBeenCalledWith(expect.stringContaining('transfer:claim:code:'), JSON.stringify({ recipientUserId: 'u1' }), 'EX', CLAIM_CODE_TTL_SECONDS);
    });
    it('an org recipient → recipientType ORGANIZATION', async () => {
      const { svc } = setup();
      const res = await svc.mint({ recipientOrganizationId: 'o1' });
      expect(res.recipientType).toBe('ORGANIZATION');
    });
  });

  describe('consume', () => {
    it('round-trips a minted code (mint → consume returns the recipient) and is single-use', async () => {
      const { svc } = setup();
      const { code } = await svc.mint({ recipientUserId: 'u1' });
      expect(await svc.consume(code)).toEqual({ recipientUserId: 'u1' });
      // Second consume misses (GETDEL already removed it) → single-use.
      expect(await svc.consume(code)).toBeNull();
    });
    it('tolerates human re-typing (hyphen/case variance normalises to the same key)', async () => {
      const { svc } = setup();
      const { code } = await svc.mint({ recipientUserId: 'u1' });
      const messy = code.replace(/-/g, '').toLowerCase();
      expect(await svc.consume(messy)).toEqual({ recipientUserId: 'u1' });
    });
    it('a nonexistent / malformed code → null (uniform miss, no Redis call for empty)', async () => {
      const { svc, evalFn } = setup();
      expect(await svc.consume('!!!')).toBeNull();
      expect(evalFn).not.toHaveBeenCalled(); // malformed short-circuits before Redis
      expect(await svc.consume('ZZZZ-ZZZZ')).toBeNull(); // well-formed but absent
    });
    it('a corrupt stored value → null (never throws)', async () => {
      const { svc } = setup('not-json');
      expect(await svc.consume('ZZZZ-ZZZZ')).toBeNull();
    });
  });
});
