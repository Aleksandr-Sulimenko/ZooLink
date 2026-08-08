import { isIP } from 'node:net';

/**
 * Rate-limit tracker: which client a throttle bucket belongs to (AUDIT5 §F1b "Б1", security co-sign
 * У-1..У-3).
 *
 * WHY this exists. `@nestjs/throttler`'s stock tracker is `req.ip`. Caddy is the only public entry
 * (ADR-0009) and the `api` service publishes no host port, so every request reaches Express with the
 * EDGE container's address → `req.ip` is one and the same value for the whole internet. Every bucket
 * (default 100/60s, register 5/15min, recover, report, agent-token) was therefore platform-wide: at
 * the named load (1000 DAU) the platform throttles itself on day one, and the 6th registration in
 * any 15 minutes gets a 429 no matter who sends it.
 *
 * WHAT we trust. Exactly ONE header — `X-Real-IP` — and nothing else. Never the multi-hop forwarded
 * chain, never an Express hop-count setting. The edge writes it authoritatively.
 *
 * THE HONEST CAVEAT (security co-sign, verbatim):
 *   «мы берём заголовок, который Caddy НЕ санирует (в отличие от XFF, перезаписываемого по
 *   умолчанию); край обязан его перезаписать; забывчивость сделана безопасной через site-level strip
 *   + CI-замок»
 * EN: we take the header Caddy does NOT sanitise (unlike XFF, which it overwrites by default); the
 * edge is REQUIRED to overwrite it; forgetting to is made safe by the site-level strip + the CI lock.
 * Verified live against caddy:2-alpine (2026-08-07): with `header_up X-Real-IP {remote_host}` a
 * client-sent `X-Real-IP: 6.6.6.6` arrives as the real peer; WITHOUT the site-level
 * `request_header -X-Real-IP`, a route that forgot `header_up` passes `6.6.6.6` through verbatim.
 * Hence the two-sided contract: `deploy/Caddyfile` (У-1) + `scripts/check-edge-client-ip.sh` (У-6).
 *
 * DIRECTION OF ERROR (deliberate, asymmetric). Anything we cannot positively parse as a single IP
 * literal falls back to the socket address. Falling back means "everyone shares one bucket" — exactly
 * today's behaviour, no worse. The failure we refuse is the other one: letting a client PICK its own
 * bucket (evade its own limit, or poison someone else's).
 */

/** The one header the tracker reads. Lower-case: Node normalises incoming header names. */
export const EDGE_CLIENT_IP_HEADER = 'x-real-ip';

/** Bucket used when neither the edge header nor the socket yields a parseable address. */
export const UNKNOWN_TRACKER = 'unknown';

/** Why the tracker fell back to the socket address instead of the edge header. */
export type TrackerFallbackReason = 'absent' | 'malformed';

/**
 * Where the TCP connection came from. A property of the SOCKET, not of any header — no header can
 * change it (`trust proxy` is not enabled, so `req.ip` IS the peer). // edge-ip-grep-allow: names the premise
 * Same basis `metrics.guard.ts` already uses for its internal-only gate.
 *
 * Only two values, and deliberately NO CIDR/subnet constants for "our edge network": Docker hands out
 * subnets dynamically, so a hard-coded range would eventually be wrong and would then mislabel
 * SILENTLY — the same false-green class this whole pack exists to remove. Loopback-vs-network is
 * decidable from the address itself, forever.
 */
export type PeerClass = 'loopback' | 'network';

export interface ClientIpResolution {
  /** The throttle bucket label. */
  tracker: string;
  /** Set only when the edge header could not be used. */
  fallback?: TrackerFallbackReason;
  /** Always present: the connection's own origin, independent of every header. */
  peer: PeerClass;
}

/** The slice of an HTTP request the tracker needs (keeps this unit testable without Express). */
export interface TrackedRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * Expand an IPv6 literal into its 8 hextets. Input must already be a valid IPv6 (isIP === 6).
 * Handles `::` compression and a trailing dotted-quad (`2001:db8::192.0.2.1`).
 */
function expandIpv6(value: string): string[] | null {
  let v = value;
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (dotted) {
    const octets = dotted[1].split('.').map(Number);
    if (octets.some((o) => Number.isNaN(o) || o > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    v = `${v.slice(0, dotted.index)}${high}:${low}`;
  }

  const halves = v.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = halves[1] === '' ? [] : halves[1].split(':');
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<string>(fill).fill('0'), ...tail];
}

/**
 * Turn an address into a stable bucket label, or null when it is not a single IP literal.
 *
 * Normalisation (У-3):
 *  - IPv4 → the address itself (full /32 precision).
 *  - IPv4-mapped IPv6 (`::ffff:1.2.3.4`) → the IPv4 bucket, so the same client behind either stack
 *    shares ONE bucket (same `::ffff:` strip as metrics.guard.ts).
 *  - IPv6 → the canonical lower-case /64 PREFIX. A residential IPv6 client can rotate freely inside
 *    its own /64, so per-address buckets would hand it an unlimited supply of fresh buckets.
 *    The label is a deterministic bucket key (`2001:db8:0:0::/64`), not a display address —
 *    zero-compression is deliberately NOT applied so two spellings can never diverge.
 *  - A comma-separated list, an empty string, a port, or junk → null (→ caller falls back).
 */
export function ipToBucket(value: string): string | null {
  let v = value.trim();
  if (v === '') return null;
  // A bracketed IPv6 literal (`[::1]`) — strip the brackets, but never a port suffix: a value with a
  // port is not what the edge writes, so it stays unparseable and falls back.
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  // Zone/scope id (`fe80::1%eth0`) is link-local plumbing, not part of the identity.
  const zone = v.indexOf('%');
  if (zone !== -1) v = v.slice(0, zone);

  const kind = isIP(v);
  if (kind === 4) return v;
  if (kind !== 6) return null;

  const lower = v.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped) return isIP(mapped[1]) === 4 ? mapped[1] : null;

  const groups = expandIpv6(lower);
  if (groups === null) return null;
  const prefix = groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':');
  return `${prefix}::/64`;
}

/** Strip the wrappers `{remote_host}`/Node may add, and fold an IPv4-mapped form (У-3's own rule). */
function bareAddress(value: string): string {
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  const zone = v.indexOf('%');
  if (zone !== -1) v = v.slice(0, zone);
  const lower = v.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  return mapped ? mapped[1] : lower;
}

/**
 * Classify the connection's own origin. `::ffff:` is folded FIRST, exactly as the tracker folds it, so
 * `::ffff:127.0.0.1` and `127.0.0.1` classify identically.
 *
 * An address we cannot parse classifies as `network`, never `loopback`: the whole point of this label
 * is to keep an alarm honest, and the safe direction for an alarm is to FIRE, not to fall silent.
 */
export function classifyPeer(raw: string | undefined): PeerClass {
  if (typeof raw !== 'string' || raw.trim() === '') return 'network';
  const candidate = bareAddress(raw);

  const kind = isIP(candidate);
  if (kind === 4) return candidate.startsWith('127.') ? 'loopback' : 'network'; // 127.0.0.0/8
  if (kind !== 6) return 'network';

  const groups = expandIpv6(candidate);
  if (groups === null) return 'network';
  // ::1 — the seven leading hextets are zero and the last is 1.
  const leadingZero = groups.slice(0, 7).every((g) => parseInt(g, 16) === 0);
  return leadingZero && parseInt(groups[7], 16) === 1 ? 'loopback' : 'network';
}

/** `req.ip` with no hop-count trust IS the peer; `socket.remoteAddress` is the same value's source. */
function peerAddress(req: TrackedRequestLike): string | undefined {
  return req.ip ?? req.socket?.remoteAddress;
}

function socketBucket(req: TrackedRequestLike): string {
  const raw = peerAddress(req);
  const own = typeof raw === 'string' ? ipToBucket(raw) : null;
  return own ?? UNKNOWN_TRACKER;
}

/**
 * Resolve the throttle bucket for a request, reporting whether the edge header carried it.
 * The `fallback` reason is what feeds `zoolink_ratelimit_tracker_fallback_total` (У-4b) — a signal
 * that the edge stopped writing the header, independent of any 429.
 */
export function resolveClientIpTracker(req: TrackedRequestLike): ClientIpResolution {
  const peer = classifyPeer(peerAddress(req));
  const raw = req.headers?.[EDGE_CLIENT_IP_HEADER];

  let present: boolean;
  let presented: string | undefined;
  if (Array.isArray(raw)) {
    // The edge REPLACES the field, so more than one value means something else wrote it → untrusted.
    present = raw.length > 0;
    presented = raw.length === 1 ? raw[0] : undefined;
  } else {
    present = typeof raw === 'string';
    presented = typeof raw === 'string' ? raw : undefined;
  }

  if (!present) return { tracker: socketBucket(req), fallback: 'absent', peer };

  const bucket = presented === undefined ? null : ipToBucket(presented);
  if (bucket !== null) return { tracker: bucket, peer };
  return { tracker: socketBucket(req), fallback: 'malformed', peer };
}
