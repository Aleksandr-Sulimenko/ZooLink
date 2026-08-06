import type { CookieOptions, Request, Response } from 'express';
import { API_BASE_PATH } from '../../config/api-base';

/**
 * Refresh-token transport = an HttpOnly, Secure, SameSite=Strict cookie (API_CONVENTIONS.md §2,
 * normative). The long-lived (~7d) refresh credential is NEVER placed in the JSON body, so it is
 * unreachable to page JS and cannot be exfiltrated by XSS (AUDIT3 security.md #2). The access token
 * (short-lived, 15m) stays in the body for the Authorization header.
 */
export const REFRESH_COOKIE = 'refresh_token';

/**
 * Path scope = the auth namespace only. The cookie is sent to `${API_BASE_PATH}/auth/refresh`
 * (rotation) and `${API_BASE_PATH}/auth/logout` (targeted single-device revoke) but to nothing else —
 * least-privilege, so the credential never rides along on unrelated requests (listings, admin, …).
 *
 * DERIVED from the single public-base source (config/api-base = `/api/v1`), NOT hardcoded: the browser
 * only ever sends a cookie whose `Path` prefixes the PUBLIC request path (`/api/v1/auth/...`). Pinning
 * this to the internal `/v1/auth` (as it was) meant the cookie never matched the public path → a silent
 * re-login every ~15 min once the access token expired (AUDIT5 frontend-engineer Б-2). The set and the
 * clear MUST use the identical attributes (below), or the browser will not drop the cookie on logout.
 */
const REFRESH_COOKIE_PATH = `${API_BASE_PATH}/auth`;

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
