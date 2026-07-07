/**
 * Media-URL host allowlist (AUDIT3 security.md — photo-URL arbitrary-host finding).
 *
 * Durable media (listing photos) MUST live on OUR object storage (S3/MinIO, ADR-0008), never on a
 * seller-controlled remote origin. Accepting an arbitrary URL as durable media is a twofold hole:
 *   1) MODERATION-BYPASS / content-integrity — pre-moderation is ZooLink's core safety model, but if
 *      the DB stores only a URL (not the bytes) the seller can SWAP the remote content AFTER approval,
 *      publishing imagery the moderator never saw.
 *   2) LATENT SSRF — the day any server-side fetch lands (thumbnailing, safety-scan, link-preview) it
 *      would fetch attacker-chosen internal URLs (169.254.169.254, localhost, internal hostnames).
 *
 * The allowlist is env-driven: it is derived from the configured S3 endpoint host (S3_ENDPOINT), so a
 * dev MinIO (localhost:9000) and a prod bucket host are each accepted without extra config. Only the
 * host (incl. port) is compared — path/bucket layout is not constrained here.
 */

/** Host (incl. port) of the configured S3/MinIO endpoint, e.g. `localhost:9000` or `storage.yandexcloud.net`. */
export function s3HostFromEndpoint(s3Endpoint: string): string {
  return new URL(s3Endpoint).host;
}

/**
 * The full set of hosts durable media may be served from: always the S3/MinIO origin
 * (`s3HostFromEndpoint(s3Endpoint)`), plus the optional prod CDN host (`MEDIA_CDN_HOST`) placed in
 * front of the bucket. `cdnHost` is a bare host (`cdn.zoolink.ru`), added verbatim; empty/whitespace is
 * ignored, so the MVP default (no CDN) yields exactly the S3 host. Keeping the build here (not at the
 * call site) keeps the allowlist rule unit-testable in isolation.
 */
export function mediaAllowedHosts(s3Endpoint: string, cdnHost?: string): string[] {
  const hosts = [s3HostFromEndpoint(s3Endpoint)];
  const cdn = cdnHost?.trim();
  if (cdn) hosts.push(cdn);
  return hosts;
}

/**
 * True iff `url` is a well-formed http(s) URL whose host is in `allowedHosts`. Rejects non-URLs,
 * non-http(s) schemes (javascript:/data:/file:), and any host outside the allowlist.
 */
export function isAllowedMediaUrl(url: string, allowedHosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return allowedHosts.includes(parsed.host);
}
