import { HttpException, PreconditionFailedException } from '@nestjs/common';
import { assertIfMatch, matchesIfNoneMatch, weakEtag } from './etag.util';

describe('weakEtag', () => {
  const updatedAt = new Date('2026-06-18T10:00:00.000Z');

  it('is a weak validator and stable for the same input', () => {
    const a = weakEtag('id-1', updatedAt);
    expect(a).toMatch(/^W\/"[0-9a-f]{16}"$/);
    expect(weakEtag('id-1', updatedAt)).toBe(a);
  });

  it('changes when updated_at changes', () => {
    expect(weakEtag('id-1', updatedAt)).not.toBe(
      weakEtag('id-1', new Date('2026-06-18T10:00:01.000Z')),
    );
  });
});

describe('assertIfMatch', () => {
  const etag = weakEtag('id-1', new Date('2026-06-18T10:00:00.000Z'));

  it('throws 428 when If-Match is missing', () => {
    expect(() => assertIfMatch(undefined, etag)).toThrow(HttpException);
    try {
      assertIfMatch(undefined, etag);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(428);
    }
  });

  it('throws 412 STALE_RESOURCE on mismatch', () => {
    expect(() => assertIfMatch('W/"deadbeefdeadbeef"', etag)).toThrow(PreconditionFailedException);
  });

  it('passes when the tag matches (quotes/W- tolerant)', () => {
    expect(() => assertIfMatch(etag, etag)).not.toThrow();
  });
});

describe('matchesIfNoneMatch', () => {
  const etag = weakEtag('id-1', new Date('2026-06-18T10:00:00.000Z'));
  it('matches a present, equal tag and ignores absent header', () => {
    expect(matchesIfNoneMatch(etag, etag)).toBe(true);
    expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
  });
});
