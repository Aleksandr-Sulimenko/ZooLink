import { ProviderError } from './provider-error';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Thin wrapper over global `fetch` shared by HTTP adapters. Enforces a hard timeout
 * (AbortSignal) and normalises transport/HTTP failures into {@link ProviderError},
 * so each adapter only deals with the happy-path JSON body. Circuit-breaking and
 * retry policy are deferred to Phase 3 hardening (integrations.md §3).
 */
export async function fetchJson<T>(
  provider: string,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProviderError(provider, 'network', `request failed: ${reason}`, err);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(provider, 'http', `HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new ProviderError(provider, 'response', 'invalid JSON in provider response', err);
  }
}
