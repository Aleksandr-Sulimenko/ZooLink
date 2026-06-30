import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';

/** Significant response headers replayed verbatim on a cached hit (so ETag/If-Match still works). */
interface StoredHeaders {
  etag?: string;
}

interface InProgressRecord {
  state: 'in-progress';
  requestHash: string;
}

interface DoneRecord {
  state: 'done';
  requestHash: string;
  status: number;
  body: unknown;
  headers: StoredHeaders;
}

type StoredRecord = InProgressRecord | DoneRecord;

const TTL_SECONDS = 24 * 60 * 60; // API_CONVENTIONS.md §11: 24h replay window for the completed result
const IN_FLIGHT_TTL_SECONDS = 60; // reservation lease while the first request is still executing
const RETRY_AFTER_SECONDS = 1; // hint for a concurrent caller to re-poll the (soon-stored) result
const KEY_PREFIX = 'idem:';

/**
 * Idempotency for unsafe POSTs (API_CONVENTIONS.md §11). When the client sends `Idempotency-Key`:
 * - first request → atomically claim the key (`SET NX`) with an `in-progress` reservation, execute,
 *   then overwrite it with the completed `(request-hash, status, body, significant-headers)` for 24h;
 * - a **concurrent** replay arriving while the first is still in-flight → `409
 *   IDEMPOTENCY_KEY_IN_PROGRESS` (+ `Retry-After`), so the duplicate request cannot run a second time
 *   in parallel (the audit-2026-06-30 gap: the previous store-on-completion left a window where two
 *   identical POSTs both executed before either had stored its result);
 * - a replay after completion with the same body → the stored response (status + body + headers);
 * - same key + different body → `422 IDEMPOTENCY_KEY_REUSED`.
 * No header → pass through unchanged (the header is optional).
 *
 * If the handler throws, the reservation is released so the client may legitimately retry — only
 * successful responses are cached for replay (unchanged from before).
 *
 * Apply per route: `@UseInterceptors(IdempotencyInterceptor)`.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header('Idempotency-Key');
    if (!key) {
      return next.handle();
    }

    const requestHash = this.hashRequest(req);
    const redisKey = `${KEY_PREFIX}${key}`;

    // Atomically claim the key with an in-progress reservation. NX succeeds only when the key is
    // absent → this request is the single winner that may execute; everyone else takes the branch below.
    const reservation: InProgressRecord = { state: 'in-progress', requestHash };
    const claimed = await this.redis.client.set(
      redisKey,
      JSON.stringify(reservation),
      'EX',
      IN_FLIGHT_TTL_SECONDS,
      'NX',
    );

    if (claimed === null) {
      // The key already exists — a sibling request reserved it, completed it, or it just expired.
      const existing = await this.redis.client.get(redisKey);
      if (existing) {
        const stored = JSON.parse(existing) as StoredRecord;
        if (stored.requestHash !== requestHash) {
          throw new UnprocessableEntityException({
            message: 'Idempotency-Key was already used with a different request body',
            code: 'IDEMPOTENCY_KEY_REUSED',
          });
        }
        if (stored.state === 'in-progress') {
          // Same key + same body, but the first request has not finished → do NOT execute a second
          // time; tell the caller to retry once the result is available.
          const res = context.switchToHttp().getResponse<Response>();
          res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
          throw new ConflictException({
            message: 'A request with this Idempotency-Key is already in progress',
            code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
          });
        }
        // Completed → replay the stored response verbatim (status + significant headers + body).
        return this.replay(context, stored);
      }
      // Race: the key expired between the failed NX and the GET. Best-effort: proceed without the
      // reservation rather than block a legitimate request.
    }

    const holdsReservation = claimed !== null;
    return next.handle().pipe(
      tap((body: unknown) => {
        const res = context.switchToHttp().getResponse<Response>();
        const record: DoneRecord = {
          state: 'done',
          requestHash,
          status: res.statusCode,
          body,
          headers: this.captureHeaders(res),
        };
        // Overwrite the reservation with the completed result (no NX — we own the key) for the 24h
        // replay window. Failure to cache must not fail the request.
        void this.redis.client.set(redisKey, JSON.stringify(record), 'EX', TTL_SECONDS);
      }),
      catchError((err: unknown) => {
        // Release our reservation so the client may retry; a failed request is never cached for replay.
        if (holdsReservation) {
          void this.redis.client.del(redisKey);
        }
        return throwError(() => err);
      }),
    );
  }

  private replay(context: ExecutionContext, stored: DoneRecord): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    res.status(stored.status);
    res.setHeader('Idempotency-Replayed', 'true');
    if (stored.headers.etag) res.setHeader('ETag', stored.headers.etag);
    return of(stored.body);
  }

  private captureHeaders(res: Response): StoredHeaders {
    const etag = res.getHeader('ETag');
    return { etag: typeof etag === 'string' ? etag : undefined };
  }

  private hashRequest(req: Request): string {
    const body: unknown = req.body ?? null;
    const payload = JSON.stringify({ method: req.method, url: req.originalUrl, body });
    return createHash('sha256').update(payload).digest('hex');
  }
}
