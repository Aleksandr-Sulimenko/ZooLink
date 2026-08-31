import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  codeForStatus,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  type ProblemFieldError,
} from './problem.types';
import { ProviderError } from '../providers/provider-error';
import type { ProviderFailureMetrics } from '../providers/provider-failure.metrics';
import { Sentry } from '../observability/sentry';

/**
 * The ONLY members of a thrown HttpException's payload that reach the response body: `message`
 * (→ `detail`), `code` and `errors`. Every other member is dropped DELIBERATELY — an exception
 * payload is an internal object, not an API contract, and echoing members nobody vetted is how
 * driver text and topology (`host:port`) reach clients, some of them unauthenticated (ADR-0043).
 * The list lives here, next to the only code that applies it.
 */
const PROJECTED_PAYLOAD_KEYS = ['message', 'code', 'errors'] as const;

/** Consumed by this filter as response HEADERS (§8), intentionally never as body members. */
const HEADER_PAYLOAD_KEYS = ['retryAfter', 'rateLimit'] as const;

/**
 * Two EXACT names — not a pattern, not a prefix, not "the members Nest adds".
 *
 *  `statusCode`  Nest's `HttpException.createBody` stamps it on every string-argument exception:
 *                `new NotFoundException('gone')` → `{ message, error: 'Not Found', statusCode: 404 }`.
 *  `error`       the same envelope's human label ("Not Found"), a duplicate of `title`.
 *
 * WHY they are exempt from the drop-log: they are the FRAMEWORK's envelope, not a payload anyone
 * attached, so reporting them would fire the line on nearly every error in the system — and a warning
 * that fires always says nothing. That is how such lists usually die.
 *
 * Adding a name here is therefore a SEPARATE DECISION with its own reason written beside it, never a
 * matter of "looked similar, appended by analogy". If a member is ours and it is being dropped, the
 * answer is either to project it deliberately or to let the line report it — not to silence it here.
 */
const FRAMEWORK_PAYLOAD_KEYS = ['statusCode', 'error'] as const;

/** Anything outside this union is an unknown member: dropped from the body, NAMED in the log. */
const KNOWN_PAYLOAD_KEYS: ReadonlySet<string> = new Set<string>([
  ...PROJECTED_PAYLOAD_KEYS,
  ...HEADER_PAYLOAD_KEYS,
  ...FRAMEWORK_PAYLOAD_KEYS,
]);

/**
 * Global exception filter — converts every thrown error into an RFC 7807 Problem document
 * (API_CONVENTIONS.md §4). Never leaks stack traces or internals to clients; 5xx details are
 * logged server-side and replaced with a generic message.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  /**
   * Счётчик отказов провайдеров — НЕОБЯЗАТЕЛЕН по построению (находка №145). Фильтр ставится руками
   * в main.ts (`useGlobalFilters`), вне DI, и живёт также в сводах, где реестра метрик нет вовсе.
   * Отсутствие счётчика ОБЪЯВЛЯЕТСЯ вслух самим ProviderFailureMetrics при построении, а не молча
   * ослепляет тревогу.
   */
  constructor(private readonly providerFailures?: Pick<ProviderFailureMetrics, 'record'>) {}

  /**
   * Signatures (route + dropped-key set) already reported once. Bounded: when the cap is reached the
   * window is CLEARED rather than frozen — a permanent mute is the very defect ADR-0043 exists to
   * stop, and an unbounded set on a per-request path is a leak of its own.
   */
  private static readonly DROP_LOG_MEMORY_CAP = 512;
  private readonly reportedDrops = new Set<string>();

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof ProviderError
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestId = (res.getHeader('x-request-id') as string | undefined) ?? undefined;
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: this.titleFor(status),
      status,
      code: codeForStatus(status),
      instance: req.originalUrl,
      requestId,
    };

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      this.applyHttpExceptionBody(problem, response);
      // Retry-After header (§8): a thrown HttpException may carry a numeric `retryAfter` (seconds) —
      // e.g. a per-market contact-reveal rate limit. Surface it as the header (kept out of the JSON
      // body). The header persists because this filter never strips previously-set headers.
      if (typeof response === 'object' && response !== null) {
        const body = response as Record<string, unknown>;
        const retryAfter = body.retryAfter;
        if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
          res.setHeader('Retry-After', String(Math.max(0, Math.ceil(retryAfter))));
        }
        // Rate-limit headers (§8): a 429 may carry `rateLimit: { limit, remaining }` — surface them as
        // X-RateLimit-Limit / X-RateLimit-Remaining per API_CONVENTIONS (kept out of the JSON body). A
        // general seam mirroring `retryAfter`; endpoints that don't set it are unaffected.
        const rateLimit = body.rateLimit;
        if (typeof rateLimit === 'object' && rateLimit !== null) {
          const { limit, remaining } = rateLimit as Record<string, unknown>;
          if (typeof limit === 'number' && Number.isFinite(limit)) {
            res.setHeader('X-RateLimit-Limit', String(Math.max(0, Math.trunc(limit))));
          }
          if (typeof remaining === 'number' && Number.isFinite(remaining)) {
            res.setHeader('X-RateLimit-Remaining', String(Math.max(0, Math.trunc(remaining))));
          }
        }
      }
      this.reportDroppedPayloadKeys(req, response);
    } else if (exception instanceof ProviderError) {
      // External provider failed. Log the (possibly sensitive) detail server-side only and
      // return a generic 503 UPSTREAM_UNAVAILABLE — never echo the upstream message/body.
      this.logger.error(
        `Provider error [${exception.provider}/${exception.kind}] on ${req.method} ${req.originalUrl}: ${exception.message}`,
      );
      // ═══ РОД ОТКАЗА ДОЖИВАЕТ ДО ПРИБОРОВ ДЕЖУРНОГО (находка №145) ═══
      // Различение «чинить или ждать» существовало В ТИПЕ и терялось на последнем метре: один
      // logger.error и один 503 на все четыре рода, Sentry — только для «неожиданной ошибки».
      // Теперь: счётчик с метками provider/kind (правило тревоги — в provider-failure.metrics.ts),
      // а kind=config поднимает ТРЕВОГУ, потому что это ПОСТОЯННЫЙ отказ НАШЕЙ конфигурации —
      // ждать вендора бесполезно, а выглядит оно как вендорская сетевая шумиха.
      this.providerFailures?.record(exception.provider, exception.kind);
      if (exception.kind === 'config') {
        Sentry.captureException(exception, {
          tags: {
            requestId: requestId ?? 'unknown',
            provider: exception.provider,
            providerErrorKind: exception.kind,
          },
        });
      }
      problem.detail = 'An upstream service is temporarily unavailable. Please retry shortly.';
    } else {
      // Unexpected error: log full detail, report to Sentry, expose nothing.
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      Sentry.captureException(exception, { tags: { requestId: requestId ?? 'unknown' } });
      problem.detail = 'An unexpected error occurred.';
    }

    res
      .status(status)
      .setHeader('Content-Type', PROBLEM_CONTENT_TYPE)
      .json(problem);
  }

  private titleFor(status: number): string {
    return HttpStatus[status] ? String(HttpStatus[status]).replace(/_/g, ' ') : 'Error';
  }

  /**
   * A payload member outside the allow-list is not an error — but its loss must never be SILENT
   * (ADR-0043 rule 2): a caller who attached data expecting it to surface would otherwise never
   * learn it was cut. Logs key NAMES and the route, never values — the payload may hold exactly the
   * secrets this allow-list exists to withhold.
   */
  private reportDroppedPayloadKeys(req: Request, response: string | object): void {
    if (typeof response !== 'object' || response === null) return;
    const dropped = Object.keys(response as Record<string, unknown>)
      .filter((key) => !KNOWN_PAYLOAD_KEYS.has(key))
      .sort();
    if (dropped.length === 0) return;

    const route = `${req.method} ${this.routePatternOf(req)}`;
    // Dedup on ROUTE + key set, not the key set alone: the same unknown payload thrown from two
    // places would otherwise log once and the second site's ADDRESS would be lost.
    const signature = `${route} | ${dropped.join(',')}`;
    if (this.reportedDrops.has(signature)) return;
    if (this.reportedDrops.size >= ProblemExceptionFilter.DROP_LOG_MEMORY_CAP) {
      this.reportedDrops.clear();
    }
    this.reportedDrops.add(signature);

    this.logger.warn(
      `HttpException payload members dropped by the RFC 7807 allow-list on ${route}: ` +
        `[${dropped.join(', ')}] — key NAMES only, values are never logged (ADR-0043)`,
    );
  }

  /**
   * The route PATTERN when Express matched one (`/api/v1/listings/:id`), else the raw path without
   * the query string. The pattern keeps the dedup signature low-cardinality: `originalUrl` carries
   * ids, which would make every request a fresh signature and turn the dedup into a flood.
   */
  private routePatternOf(req: Request): string {
    // `Request['route']` is typed `any` by @types/express — go through `unknown` to stay type-safe.
    const pattern = (req as unknown as { route?: { path?: unknown } }).route?.path;
    if (typeof pattern === 'string' && pattern.length > 0) {
      return `${req.baseUrl}${pattern}`;
    }
    return (req.originalUrl ?? '').split('?')[0] ?? '';
  }

  /**
   * Projects the payload onto the problem document through the allow-list above: `message` →
   * `detail`, `code`, `errors` — and NOTHING else, by design (see PROJECTED_PAYLOAD_KEYS).
   */
  private applyHttpExceptionBody(problem: ProblemDetails, response: string | object): void {
    if (typeof response === 'string') {
      problem.detail = response;
      return;
    }
    const body = response as Record<string, unknown>;
    if (typeof body.message === 'string') {
      problem.detail = body.message;
    } else if (Array.isArray(body.message)) {
      // class-validator emits string[] — surface as field-level errors.
      problem.detail = 'Validation failed';
      problem.errors = (body.message as string[]).map<ProblemFieldError>((m) => ({
        field: this.guessField(m),
        message: m,
      }));
    }
    if (typeof body.code === 'string') {
      problem.code = body.code;
    }
    // RFC7807 §3.1 extension member: a caller may attach an explicit `errors` array (e.g. the
    // moderation ALREADY_CLAIMED holder context). Pass it through verbatim when present (and not
    // already populated by the class-validator branch above).
    if (Array.isArray(body.errors) && problem.errors === undefined) {
      problem.errors = body.errors as ProblemDetails['errors'];
    }
  }

  private guessField(message: string): string {
    // class-validator messages start with the property name, e.g. "email must be an email".
    return message.split(' ')[0] ?? '_';
  }
}
