import type { CookieOptions, Request, Response } from 'express';

/**
 * Refresh-token transport = an HttpOnly, Secure, SameSite=Strict cookie (API_CONVENTIONS.md §2,
 * normative). The long-lived (~7d) refresh credential is NEVER placed in the JSON body, so it is
 * unreachable to page JS and cannot be exfiltrated by XSS (AUDIT3 security.md #2). The access token
 * (short-lived, 15m) stays in the body for the Authorization header.
 */
export const REFRESH_COOKIE = 'refresh_token';

/**
 * Path scope = the auth namespace only. The cookie is sent to /v1/auth/refresh (rotation) and
 * /v1/auth/logout (targeted single-device revoke) but to nothing else — least-privilege, so the
 * credential never rides along on unrelated requests (listings, admin, …). URI versioning puts the
 * auth controller under /v1/auth.
 */
const REFRESH_COOKIE_PATH = '/v1/auth';

/** Cookie attributes for setting the refresh cookie. `secure` is always on (Caddy terminates TLS). */
function refreshCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/** Sets the refresh cookie on the response. */
export function setRefreshCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(maxAgeMs));
}

/** Clears the refresh cookie (logout). Attributes must match the set for the browser to drop it. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * Reads the refresh cookie straight from the raw Cookie header (dependency-free — no cookie-parser
 * needed, nothing else in the app reads cookies). Returns undefined when absent.
 */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
