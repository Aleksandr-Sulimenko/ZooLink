import { presignS3Url, type PresignInput } from './sigv4';

const base: PresignInput = {
  method: 'GET',
  endpoint: 'https://storage.yandexcloud.net',
  region: 'ru-central1',
  accessKey: 'AKIAEXAMPLE',
  secretKey: 'secretexamplekey',
  bucket: 'zoolink-media',
  key: 'animals/123/photo.jpg',
  expiresInSeconds: 900,
  now: new Date('2026-06-18T12:00:00.000Z'),
};

describe('presignS3Url', () => {
  it('produces a URL with all required SigV4 query params', () => {
    const url = new URL(presignS3Url(base));
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260618T120000Z');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAEXAMPLE/20260618/ru-central1/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses path-style addressing and preserves key slashes', () => {
    const url = new URL(presignS3Url(base));
    expect(url.pathname).toBe('/zoolink-media/animals/123/photo.jpg');
  });

  it('is deterministic for identical input', () => {
    expect(presignS3Url(base)).toBe(presignS3Url(base));
  });

  it('changes the signature when the key changes', () => {
    const a = new URL(presignS3Url(base)).searchParams.get('X-Amz-Signature');
    const b = new URL(presignS3Url({ ...base, key: 'animals/123/other.jpg' })).searchParams.get(
      'X-Amz-Signature',
    );
    expect(a).not.toBe(b);
  });

  it('differs between GET and PUT (method is signed)', () => {
    const get = new URL(presignS3Url(base)).searchParams.get('X-Amz-Signature');
    const put = new URL(presignS3Url({ ...base, method: 'PUT' })).searchParams.get(
      'X-Amz-Signature',
    );
    expect(get).not.toBe(put);
  });

  it('escapes special characters in the key', () => {
    const url = new URL(presignS3Url({ ...base, key: 'avatars/a b+c.png' }));
    expect(url.pathname).toBe('/zoolink-media/avatars/a%20b%2Bc.png');
  });
});
