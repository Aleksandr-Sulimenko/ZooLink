import { createHash, createHmac } from 'node:crypto';

/**
 * Self-contained AWS Signature V4 *query-string* presigner for S3-compatible storage
 * (MinIO / Yandex Object Storage). We sign only the `host` header and use UNSIGNED-PAYLOAD,
 * which is the standard recipe for presigned GET/PUT URLs and avoids pulling in the heavy
 * AWS SDK for a single, well-defined operation (keeps the dependency surface small —
 * see security backlog in BACKEND_IMPLEMENTATION_PLAN.md). Path-style addressing is used
 * so the same code works for MinIO, Yandex, and any S3-compatible endpoint.
 */
export interface PresignInput {
  method: 'GET' | 'PUT';
  endpoint: string; // e.g. https://storage.yandexcloud.net or http://minio:9000
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  key: string;
  expiresInSeconds: number;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

/** RFC 3986 encoding (stricter than encodeURIComponent — also escapes !*'()). */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key as a canonical URI path, preserving "/" separators. */
function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((seg) => rfc3986(seg))
    .join('/');
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export function presignS3Url(input: PresignInput): string {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

  const url = new URL(input.endpoint);
  const host = url.host;
  const canonicalUri = `/${rfc3986(input.bucket)}/${encodeKeyPath(input.key)}`;
  const credentialScope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${input.accessKey}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${input.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
