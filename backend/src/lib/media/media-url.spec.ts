import { isAllowedMediaUrl, mediaAllowedHosts, s3HostFromEndpoint } from './media-url';

/**
 * Media host allowlist (AUDIT3 security.md — durable photos must live on OUR storage, never a
 * seller-controlled origin). Wave F adds an optional MEDIA_CDN_HOST in front of the S3 bucket.
 */
describe('media-url allowlist', () => {
  it('derives the S3 host (incl. port) from the endpoint URL', () => {
    expect(s3HostFromEndpoint('http://localhost:9000')).toBe('localhost:9000');
    expect(s3HostFromEndpoint('https://storage.yandexcloud.net')).toBe('storage.yandexcloud.net');
  });

  it('allowlist is just the S3 host when no CDN host is configured', () => {
    expect(mediaAllowedHosts('http://localhost:9000')).toEqual(['localhost:9000']);
    expect(mediaAllowedHosts('http://localhost:9000', '')).toEqual(['localhost:9000']);
    expect(mediaAllowedHosts('http://localhost:9000', '   ')).toEqual(['localhost:9000']);
  });

  it('adds the CDN host to the allowlist when MEDIA_CDN_HOST is set', () => {
    expect(mediaAllowedHosts('https://storage.yandexcloud.net', 'cdn.zoolink.ru')).toEqual([
      'storage.yandexcloud.net',
      'cdn.zoolink.ru',
    ]);
  });

  it('accepts a URL served from the configured CDN host', () => {
    const allowed = mediaAllowedHosts('https://storage.yandexcloud.net', 'cdn.zoolink.ru');
    expect(isAllowedMediaUrl('https://cdn.zoolink.ru/media/listing/1.jpg', allowed)).toBe(true);
    // The S3 origin still passes too.
    expect(isAllowedMediaUrl('https://storage.yandexcloud.net/zoolink-media/1.jpg', allowed)).toBe(true);
  });

  it('rejects a foreign host even when a CDN is configured', () => {
    const allowed = mediaAllowedHosts('https://storage.yandexcloud.net', 'cdn.zoolink.ru');
    expect(isAllowedMediaUrl('https://evil.example.com/x.jpg', allowed)).toBe(false);
    // No scheme confusion: javascript:/data: are rejected regardless of host.
    expect(isAllowedMediaUrl('javascript:alert(1)', allowed)).toBe(false);
  });

  it('rejects the CDN host when it is NOT configured (no implicit trust)', () => {
    const allowed = mediaAllowedHosts('https://storage.yandexcloud.net');
    expect(isAllowedMediaUrl('https://cdn.zoolink.ru/media/1.jpg', allowed)).toBe(false);
  });
});
