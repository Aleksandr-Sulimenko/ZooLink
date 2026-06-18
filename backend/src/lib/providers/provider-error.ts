/**
 * Uniform failure type for every external-provider adapter. Domain code catches this
 * instead of vendor-specific shapes, and the global RFC7807 filter maps it to a 502/503
 * `Problem`. `kind` lets callers branch on whether a retry/fallback is sensible.
 */
export type ProviderErrorKind =
  | 'network' // transport/timeout failure — typically retryable
  | 'http' // non-2xx HTTP response from the provider
  | 'response' // 2xx but a provider-level error payload
  | 'config'; // adapter not configured / capability disabled (e.g. payments off)

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}
