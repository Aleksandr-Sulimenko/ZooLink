import { presignS3Url } from './sigv4';
import type {
  ObjectStorage,
  PresignOptions,
  PresignedUpload,
} from './object-storage.port';

export interface S3Config {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

const DEFAULT_EXPIRY_SECONDS = 900; // 15 minutes

/**
 * S3-compatible object storage adapter. Works against MinIO (dev) and Yandex Object
 * Storage (prod) without code changes — the only difference is endpoint/credentials.
 * No vendor SDK: presigning is done by {@link presignS3Url}.
 */
export class S3ObjectStorage implements ObjectStorage {
  constructor(private readonly cfg: S3Config) {}

  presignUpload(key: string, opts?: PresignOptions): Promise<PresignedUpload> {
    const expiresInSeconds = opts?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
    const url = presignS3Url({ method: 'PUT', key, expiresInSeconds, ...this.cfg });
    return Promise.resolve({ key, url, method: 'PUT', expiresInSeconds });
  }

  presignDownload(key: string, opts?: PresignOptions): Promise<string> {
    const expiresInSeconds = opts?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
    return Promise.resolve(presignS3Url({ method: 'GET', key, expiresInSeconds, ...this.cfg }));
  }
}
