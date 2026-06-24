/**
 * S3-compatible object storage (MinIO dev / Yandex Object Storage prod — ADR-0008).
 * The bucket is private; clients upload and download via short-lived presigned URLs only.
 */
export interface PresignOptions {
  expiresInSeconds?: number;
}

export interface PresignedUpload {
  key: string;
  url: string;
  method: 'PUT';
  expiresInSeconds: number;
}

export interface ObjectStorage {
  /** Presigned PUT URL the client uses to upload an object directly to storage. */
  presignUpload(key: string, opts?: PresignOptions): Promise<PresignedUpload>;
  /** Presigned GET URL the client uses to download a private object. */
  presignDownload(key: string, opts?: PresignOptions): Promise<string>;
}
