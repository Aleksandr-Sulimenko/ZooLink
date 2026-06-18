import { HttpException, HttpStatus, PreconditionFailedException } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * Optimistic-concurrency helpers (API_CONVENTIONS.md §10).
 * ETag is a WEAK validator derived from the resource's updated_at (+id for safety).
 */
export function weakEtag(id: string, updatedAt: Date): string {
  const hash = createHash('sha1').update(`${id}:${updatedAt.toISOString()}`).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

/** Normalizes a possibly-quoted / W/-prefixed header value for comparison. */
function normalize(tag: string): string {
  return tag.trim().replace(/^W\//, '').replace(/"/g, '');
}

/**
 * Enforces If-Match on a mutating PATCH/PUT (API_CONVENTIONS.md §10):
 * - missing If-Match           → 428 Precondition Required
 * - present but does not match  → 412 Precondition Failed (code STALE_RESOURCE)
 */
export function assertIfMatch(ifMatchHeader: string | undefined, currentEtag: string): void {
  if (!ifMatchHeader) {
    throw new HttpException(
      { message: 'If-Match header is required for this update', code: 'PRECONDITION_REQUIRED' },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const provided = ifMatchHeader.split(',').map(normalize);
  if (!provided.includes(normalize(currentEtag))) {
    throw new PreconditionFailedException({
      message: 'Resource has changed; re-fetch and retry',
      code: 'STALE_RESOURCE',
    });
  }
}

/** True when a conditional GET may return 304 (API_CONVENTIONS.md §13). */
export function matchesIfNoneMatch(ifNoneMatch: string | undefined, currentEtag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').map(normalize).includes(normalize(currentEtag));
}
