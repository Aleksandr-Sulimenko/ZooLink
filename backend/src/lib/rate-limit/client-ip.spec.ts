import {
  EDGE_CLIENT_IP_HEADER,
  UNKNOWN_TRACKER,
  classifyPeer,
  ipToBucket,
  resolveClientIpTracker,
  type TrackedRequestLike,
} from './client-ip';

/**
 * AUDIT5 §F1b + security co-sign У-3. The tracker is the whole rate-limit control: get it wrong
 * one way and every client shares one bucket (429 on day one), the other way and a client picks its
 * own bucket (evades its limit, poisons someone else's).
 */
const req = (headers: Record<string, string | string[] | undefined>, ip?: string): TrackedRequestLike => ({
  headers,
  ip,
});

const trackerOf = (headers: Record<string, string | string[] | undefined>, ip?: string): string =>
  resolveClientIpTracker(req(headers, ip)).tracker;

describe('ipToBucket — normalisation (У-3)', () => {
  it('keeps an IPv4 address at full precision', () => {
    expect(ipToBucket('1.2.3.4')).toBe('1.2.3.4');
    expect(ipToBucket('203.0.113.9')).toBe('203.0.113.9');
  });

  it('folds an IPv4-mapped IPv6 into the SAME bucket as the plain IPv4 form', () => {
    expect(ipToBucket('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipToBucket('::ffff:1.2.3.4')).toBe(ipToBucket('1.2.3.4'));
    // Upper-case hex in the mapped prefix must not split the bucket either.
    expect(ipToBucket('::FFFF:1.2.3.4')).toBe('1.2.3.4');
  });

  it('is case- and form-insensitive for IPv6 (2001:db8::1 == 2001:0DB8::1)', () => {
    expect(ipToBucket('2001:db8::1')).toBe(ipToBucket('2001:0DB8::1'));
    // Fully-expanded spelling of the same address.
    expect(ipToBucket('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(ipToBucket('2001:db8::1'));
  });

  it('truncates IPv6 to /64 so a client cannot rotate into fresh buckets inside its own prefix', () => {
    expect(ipToBucket('2001:db8::1')).toBe(ipToBucket('2001:db8::2'));
    expect(ipToBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipToBucket('2001:db8:0:0:ffff:ffff:ffff:ffff')).toBe(ipToBucket('2001:db8::1'));
  });

  it('keeps a DIFFERENT /64 in a different bucket', () => {
    expect(ipToBucket('2001:db8:1::1')).toBe('2001:db8:1:0::/64');
    expect(ipToBucket('2001:db8:1::1')).not.toBe(ipToBucket('2001:db8::1'));
    expect(ipToBucket('2001:db8:0:1::1')).not.toBe(ipToBucket('2001:db8::1'));
  });

  it('normalises a bracketed literal and drops an IPv6 zone id', () => {
    expect(ipToBucket('[::1]')).toBe(ipToBucket('::1'));
    expect(ipToBucket('fe80::1%eth0')).toBe(ipToBucket('fe80::1'));
  });

  it('rejects anything that is not a single IP literal', () => {
    expect(ipToBucket('1.1.1.1, 2.2.2.2')).toBeNull(); // a chain, not one client
    expect(ipToBucket('')).toBeNull();
    expect(ipToBucket('   ')).toBeNull();
    expect(ipToBucket('garbage')).toBeNull();
    expect(ipToBucket('300.1.1.1')).toBeNull(); // out-of-range octet
    expect(ipToBucket('1.2.3')).toBeNull();
    expect(ipToBucket('1.2.3.4:5678')).toBeNull(); // a port is not what the edge writes
    expect(ipToBucket('2001:db8::1::2')).toBeNull(); // two `::` runs
    expect(ipToBucket('$(whoami)')).toBeNull();
    expect(ipToBucket('1.2.3.4\n5.6.7.8')).toBeNull();
  });
});

describe('resolveClientIpTracker — which value is trusted', () => {
  it('uses the edge header when it carries one IP, NOT the socket address', () => {
    const resolution = resolveClientIpTracker(req({ [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, '10.0.0.5'));
    expect(resolution.tracker).toBe('203.0.113.7');
    expect(resolution.fallback).toBeUndefined();
  });

  it('gives two different edge IPs two DIFFERENT buckets (the §F1b fix)', () => {
    const a = trackerOf({ [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, '10.0.0.5');
    const b = trackerOf({ [EDGE_CLIENT_IP_HEADER]: '198.51.100.4' }, '10.0.0.5');
    expect(a).not.toBe(b);
  });

  it('gives the same edge IP the SAME bucket even from different sockets', () => {
    const a = trackerOf({ [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, '10.0.0.5');
    const b = trackerOf({ [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, '10.0.0.9');
    expect(a).toBe(b);
  });

  it('falls back to the socket when the header is absent, and says so (source=absent)', () => {
    const resolution = resolveClientIpTracker(req({}, '10.0.0.5'));
    expect(resolution.tracker).toBe('10.0.0.5');
    expect(resolution.fallback).toBe('absent');
  });

  it.each([
    ['empty', ''],
    ['whitespace', '  '],
    ['a chain', '1.1.1.1, 2.2.2.2'],
    ['junk', 'garbage'],
    ['out-of-range', '300.1.1.1'],
    ['with a port', '1.2.3.4:9999'],
  ])('falls back to the socket on a malformed header (%s) — never trusts the raw string', (_label, value) => {
    const resolution = resolveClientIpTracker(req({ [EDGE_CLIENT_IP_HEADER]: value }, '10.0.0.5'));
    expect(resolution.tracker).toBe('10.0.0.5');
    expect(resolution.fallback).toBe('malformed');
  });

  it('does not trust a repeated header (only the edge writes it, and it REPLACES)', () => {
    const resolution = resolveClientIpTracker(
      req({ [EDGE_CLIENT_IP_HEADER]: ['203.0.113.7', '6.6.6.6'] }, '10.0.0.5'),
    );
    expect(resolution.tracker).toBe('10.0.0.5');
    expect(resolution.fallback).toBe('malformed');
  });

  it('accepts a single-element array form (Node may expose a lone value either way)', () => {
    expect(trackerOf({ [EDGE_CLIENT_IP_HEADER]: ['203.0.113.7'] }, '10.0.0.5')).toBe('203.0.113.7');
  });

  it('normalises the FALLBACK socket address too, so buckets stay stable across stacks', () => {
    expect(trackerOf({}, '::ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(trackerOf({}, '::ffff:10.0.0.5')).toBe(trackerOf({}, '10.0.0.5'));
  });

  it('never yields undefined: no header and no usable socket → one explicit shared bucket', () => {
    expect(trackerOf({})).toBe(UNKNOWN_TRACKER);
    expect(trackerOf({}, 'not-an-ip')).toBe(UNKNOWN_TRACKER);
    expect(resolveClientIpTracker({}).tracker).toBe(UNKNOWN_TRACKER);
  });

  it('falls back to socket.remoteAddress when req.ip is absent', () => {
    const resolution = resolveClientIpTracker({ headers: {}, socket: { remoteAddress: '10.0.0.7' } });
    expect(resolution.tracker).toBe('10.0.0.7');
    expect(resolution.fallback).toBe('absent');
  });

  it('reads only the ONE header — a forwarded chain is not consulted', () => {
    // If the tracker ever started reading the forwarded chain, this would become '9.9.9.9'.
    const resolution = resolveClientIpTracker(
      req({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, '10.0.0.5'), // edge-ip-grep-allow: negative assertion
    );
    expect(resolution.tracker).toBe('10.0.0.5');
    expect(resolution.fallback).toBe('absent');
  });
});

/**
 * У-4b amendment. The alert rule is `absent{peer="network"} == 0`, and it is only valid because `peer`
 * is read off the CONNECTION, not off a header. These tests must fail if `peer` is ever hard-coded to a
 * constant — hence every case below asserts a value DERIVED from a different input.
 */
describe('classifyPeer — loopback vs network (У-4b amendment)', () => {
  it.each([
    ['IPv4 loopback', '127.0.0.1'],
    ['anywhere in 127.0.0.0/8', '127.99.1.2'],
    ['IPv6 loopback', '::1'],
    ['IPv6 loopback, fully expanded', '0:0:0:0:0:0:0:1'],
    ['IPv4-mapped loopback (folded exactly as the tracker folds it)', '::ffff:127.0.0.1'],
    ['bracketed IPv6 loopback', '[::1]'],
  ])('classifies %s as loopback', (_label, address) => {
    expect(classifyPeer(address)).toBe('loopback');
  });

  it.each([
    ['a public address', '203.0.113.7'],
    ['a docker-range address', '172.18.0.4'],
    ['an RFC1918 address', '10.0.0.5'],
    ['a private address that is NOT loopback', '192.168.1.1'],
    ['a public IPv6 address', '2001:db8::1'],
    ['IPv4-mapped non-loopback', '::ffff:203.0.113.7'],
    ['the unspecified address', '::'],
  ])('classifies %s as network', (_label, address) => {
    expect(classifyPeer(address)).toBe('network');
  });

  it('carries NO subnet constants: a private, non-loopback address is still "network"', () => {
    // The amendment forbids an "our edge network" CIDR — Docker hands out subnets dynamically, so a
    // constant would eventually mislabel SILENTLY. 172.x/10.x/192.168.x must therefore all be network.
    for (const address of ['172.17.0.2', '172.31.255.254', '10.255.255.255', '192.168.0.2']) {
      expect(classifyPeer(address)).toBe('network');
    }
  });

  it('classifies an unparseable or missing address as network — an alarm must FIRE, not fall silent', () => {
    expect(classifyPeer(undefined)).toBe('network');
    expect(classifyPeer('')).toBe('network');
    expect(classifyPeer('   ')).toBe('network');
    expect(classifyPeer('garbage')).toBe('network');
    expect(classifyPeer('127.0.0.1, 203.0.113.7')).toBe('network'); // a chain, not an address
  });
});

describe('resolveClientIpTracker — peer accompanies every resolution', () => {
  it('a header-less LOOPBACK request → {absent, loopback} (expected in-container caller, no alarm)', () => {
    const resolution = resolveClientIpTracker({ headers: {}, ip: '127.0.0.1' });
    expect(resolution.fallback).toBe('absent');
    expect(resolution.peer).toBe('loopback');
  });

  it('a header-less NETWORK request → {absent, network} — this is the alarm condition', () => {
    const resolution = resolveClientIpTracker({ headers: {}, ip: '172.18.0.4' });
    expect(resolution.fallback).toBe('absent');
    expect(resolution.peer).toBe('network');
  });

  it('the same header-less state yields DIFFERENT peers for different sockets (not a constant)', () => {
    const loopback = resolveClientIpTracker({ headers: {}, ip: '::ffff:127.0.0.1' });
    const network = resolveClientIpTracker({ headers: {}, ip: '::ffff:10.0.0.5' });
    expect(loopback.peer).toBe('loopback');
    expect(network.peer).toBe('network');
    expect(loopback.peer).not.toBe(network.peer);
  });

  it('peer is present on a malformed header AND on a healthy one, and ignores the header value', () => {
    const malformed = resolveClientIpTracker({
      headers: { [EDGE_CLIENT_IP_HEADER]: 'garbage' },
      ip: '127.0.0.1',
    });
    expect(malformed.fallback).toBe('malformed');
    expect(malformed.peer).toBe('loopback');

    // A header claiming a public address cannot make a loopback connection look network-side.
    const healthy = resolveClientIpTracker({
      headers: { [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' },
      ip: '127.0.0.1',
    });
    expect(healthy.fallback).toBeUndefined();
    expect(healthy.peer).toBe('loopback');
  });

  it('peer comes from socket.remoteAddress when req.ip is absent', () => {
    expect(resolveClientIpTracker({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }).peer).toBe(
      'loopback',
    );
    expect(resolveClientIpTracker({ headers: {}, socket: { remoteAddress: '10.0.0.5' } }).peer).toBe(
      'network',
    );
  });
});
