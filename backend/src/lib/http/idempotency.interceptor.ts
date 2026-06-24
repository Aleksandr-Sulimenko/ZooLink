import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';

interface StoredResponse {
  requestHash: string;
  status: number;
  body: unknown;
}

const TTL_SECONDS = 24 * 60 * 60; // API_CONVENTIONS.md §11: 24h replay window
const KEY_PREFIX = 'idem:';

/**
 * Idempotency for unsafe POSTs (API_CONVENTIONS.md §11). When the client sends `Idempotency-Key`:
 * - first request → execute, store `key → (request-hash, status, body)` for 24h;
 * - replay with the same key + same body → return the stored response;
 * - same key + different body → 422.
 * No header → pass through unchanged (the header is optional).
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

    const existing = await this.redis.client.get(redisKey);
    if (existing) {
      const stored = JSON.parse(existing) as StoredResponse;
      if (stored.requestHash !== requestHash) {
        throw new UnprocessableEntityException({
          message: 'Idempotency-Key was already used with a different request body',
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      }
      const res = context.switchToHttp().getResponse<Response>();
      res.status(stored.status);
      res.setHeader('Idempotency-Replayed', 'true');
      return of(stored.body);
    }

    return next.handle().pipe(
      tap((body: unknown) => {
        const res = context.switchToHttp().getResponse<Response>();
        const record: StoredResponse = { requestHash, status: res.statusCode, body };
        // Fire-and-forget store; failure to cache must not fail the request.
        void this.redis.client.set(redisKey, JSON.stringify(record), 'EX', TTL_SECONDS, 'NX');
      }),
    );
  }

  private hashRequest(req: Request): string {
    const body: unknown = req.body ?? null;
    const payload = JSON.stringify({ method: req.method, url: req.originalUrl, body });
    return createHash('sha256').update(payload).digest('hex');
  }
}
