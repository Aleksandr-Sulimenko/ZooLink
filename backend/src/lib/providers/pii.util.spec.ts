import { maskPhone, maskEmail } from './pii.util';

describe('maskPhone', () => {
  it('keeps only the last 4 digits', () => {
    expect(maskPhone('+79991234567')).toBe('***4567');
  });
  it('returns *** for too-short input', () => {
    expect(maskPhone('12')).toBe('***');
  });
});

describe('maskEmail', () => {
  it('masks the local part but keeps the domain', () => {
    expect(maskEmail('alexander@zoolink.ru')).toBe('a***@zoolink.ru');
  });
  it('returns *** when not an email', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });
});
