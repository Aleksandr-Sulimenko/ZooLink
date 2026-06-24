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
import { Sentry } from '../observability/sentry';

/**
 * Global exception filter — converts every thrown error into an RFC 7807 Problem document
 * (API_CONVENTIONS.md §4). Never leaks stack traces or internals to clients; 5xx details are
 * logged server-side and replaced with a generic message.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

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
    } else if (exception instanceof ProviderError) {
      // External provider failed. Log the (possibly sensitive) detail server-side only and
      // return a generic 503 UPSTREAM_UNAVAILABLE — never echo the upstream message/body.
      this.logger.error(
        `Provider error [${exception.provider}/${exception.kind}] on ${req.method} ${req.originalUrl}: ${exception.message}`,
      );
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
  }

  private guessField(message: string): string {
    // class-validator messages start with the property name, e.g. "email must be an email".
    return message.split(' ')[0] ?? '_';
  }
}
