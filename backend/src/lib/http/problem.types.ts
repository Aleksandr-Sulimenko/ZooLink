/**
 * RFC 7807 "Problem Details" — the single error envelope for the API.
 * Shape mirrors docs/03-architecture/api-contracts/API_CONVENTIONS.md §4 exactly:
 * required [type, title, status, code]; `errors` is an array of field-level objects.
 */
export interface ProblemFieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  /** URI reference identifying the problem type. Defaults to "about:blank". */
  type: string;
  /** Short, human-readable summary of the problem type. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Stable machine-readable code (see STANDARD_PROBLEM_CODES). */
  code: string;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
  /** URI reference identifying the specific occurrence (request path). */
  instance?: string;
  /** Field-level validation issues. */
  errors?: ProblemFieldError[];
  /** Correlation id (mirrors x-request-id) for support/log lookup. */
  requestId?: string;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Stable `code` values per API_CONVENTIONS.md §4. Domain codes extend this set. */
export const STANDARD_PROBLEM_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'STALE_RESOURCE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL',
  503: 'UPSTREAM_UNAVAILABLE',
};

export function codeForStatus(status: number): string {
  return STANDARD_PROBLEM_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'ERROR');
}
