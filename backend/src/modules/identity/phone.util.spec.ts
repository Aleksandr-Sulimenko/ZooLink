import { normalizePhone, phoneHash } from './phone.util';

describe('normalizePhone', () => {
  it('canonicalises to +<digits>', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizePhone('79991234567')).toBe('+79991234567');
  });
  it('rejects clearly invalid numbers', () => {
    expect(() => normalizePhone('123')).toThrow();
    expect(() => normalizePhone('0123456789')).toThrow(); // leading 0
    expect(() => normalizePhone('+1234567890123456')).toThrow(); // too long
  });
});

describe('phoneHash', () => {
  const pepper = 'a'.repeat(32);

  it('is deterministic and fits VARCHAR(60) (base64url, 43 chars)', () => {
    const h = phoneHash('+79991234567', pepper);
    expect(h).toBe(phoneHash('+79991234567', pepper));
    expect(h).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.length).toBeLessThanOrEqual(60);
  });

  it('differs by phone and by pepper', () => {
    expect(phoneHash('+79991234567', pepper)).not.toBe(phoneHash('+79991234568', pepper));
    expect(phoneHash('+79991234567', pepper)).not.toBe(phoneHash('+79991234567', 'b'.repeat(32)));
  });
});
