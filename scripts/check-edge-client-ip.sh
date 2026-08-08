#!/usr/bin/env bash
# AUDIT5 §F1b — edge client-IP contract gate (security co-sign У-2 + У-6).
#
# The API rate-limiter keys its throttle buckets on the `X-Real-IP` header
# (backend/src/lib/rate-limit/client-ip.ts). That header is only trustworthy because the edge
# OVERWRITES it: Caddy overwrites XFF by default but knows nothing about `X-Real-IP`, so an inbound
# client value would otherwise reach the API verbatim (verified live against caddy:2-alpine).
#
# The control therefore has two halves in two different files, and either half alone is a silent
# fail-OPEN. This gate makes them mutually obligatory, plus forbids the two ways of re-introducing
# the spoofable path. Runnable locally exactly as CI runs it:
#   bash scripts/check-edge-client-ip.sh
#
# CHECK 1 (У-6, both directions): app reads the header  ⟺  edge rewrites the header.
# CHECK 2 (У-1b): the edge also STRIPS any inbound client value at site level, so a future handle
#         that forgets the rewrite yields "no header" (→ safe socket fallback) rather than a forged one.
# CHECK 3 (У-2): the app never consults the multi-hop forwarded chain and never enables framework
#         hop-count trust. Lines that only DISCUSS it must carry the marker below.
# CHECK 4 (У-2): `trusted_proxies` is not configured at the edge — the rewrite uses {remote_host}
#         (the real TCP peer), which is independent of it. Configuring it invites confusion about
#         which value is authoritative.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

APP_DIR="backend/src"
RL_DIR="backend/src/lib/rate-limit"
CADDYFILE="deploy/Caddyfile"
MARKER='edge-ip-grep-allow'

[ -d "$RL_DIR" ] || { echo "::error::rate-limit dir not found: $RL_DIR"; exit 2; }
[ -f "$CADDYFILE" ] || { echo "::error::Caddyfile not found: $CADDYFILE"; exit 2; }

fail=0

# --- CHECK 1: mutual obligation -------------------------------------------------------------------
app_reads_header=0
grep -rqiE "['\"]x-real-ip['\"]" "$RL_DIR" --include='*.ts' && app_reads_header=1

edge_rewrites=0
grep -qiE '^[[:space:]]*header_up[[:space:]]+X-Real-IP[[:space:]]+\{remote_host\}[[:space:]]*$' "$CADDYFILE" && edge_rewrites=1

if [ "$app_reads_header" -eq 1 ] && [ "$edge_rewrites" -eq 0 ]; then
  echo "::error::$RL_DIR trusts X-Real-IP for rate-limit buckets, but $CADDYFILE does NOT contain 'header_up X-Real-IP {remote_host}'. A client could then choose its own bucket. Restore the edge rewrite (AUDIT5 §F1b / У-1a)."
  fail=1
fi
if [ "$app_reads_header" -eq 0 ] && [ "$edge_rewrites" -eq 1 ]; then
  echo "::error::$CADDYFILE rewrites X-Real-IP, but nothing in $RL_DIR reads it any more. Either the rate-limit tracker regressed to the raw socket address (every client back in ONE bucket — AUDIT5 §F1b) or the now-dead edge rewrite should go. Fix one side."
  fail=1
fi

# --- CHECK 2: site-level strip (fail-safe half) ---------------------------------------------------
if [ "$edge_rewrites" -eq 1 ]; then
  if ! grep -qiE '^[[:space:]]*request_header[[:space:]]+-X-Real-IP[[:space:]]*$' "$CADDYFILE"; then
    echo "::error::$CADDYFILE is missing the site-level 'request_header -X-Real-IP'. Without it, any handle that forgets the per-upstream rewrite passes a client-supplied X-Real-IP through verbatim (proven live). This is the fail-safe half (У-1b)."
    fail=1
  fi
fi

# Every handle that proxies to the api upstream must go through the rewriting snippet, so a bare
# `reverse_proxy api:PORT` (no rewrite in its own block) is a hole.
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  echo "::error::bare 'reverse_proxy api:...' in $CADDYFILE — proxy to the api through the (api_upstream) snippet so the X-Real-IP rewrite applies: $hit"
  fail=1
done < <(grep -nE '^[[:space:]]*reverse_proxy[[:space:]]+api:[0-9]+[[:space:]]*$' "$CADDYFILE" || true)

# --- CHECK 3: the app never reads the forwarded chain / enables hop-count trust --------------------
# `x-forwarded-for` as a value the app READS, and the framework's hop-count trust setting.
forbidden="x-forwarded-for|trust[[:space:]]?proxy|trustProxy"
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  if grep -qF "$MARKER" <<<"$hit"; then
    echo "  allowed (marked '$MARKER'): $hit"
    continue
  fi
  echo "::error::$hit"
  echo "::error::  ^ the rate-limit tracker must read ONLY X-Real-IP (У-2). The forwarded chain is client-appendable and hop-count trust is the AUDIT4 TRASH-M1 spoofing class. Tag a line that merely DISCUSSES it with '$MARKER'."
  fail=1
done < <(grep -rniE "$forbidden" "$APP_DIR" --include='*.ts' || true)

# --- CHECK 4: no trusted_proxies at the edge ------------------------------------------------------
# Comment lines are stripped first — the header block above explains WHY it is absent.
if grep -vE '^[[:space:]]*#' "$CADDYFILE" | grep -qi 'trusted_proxies'; then
  echo "::error::'trusted_proxies' configured in $CADDYFILE. The client-IP rewrite uses {remote_host} (the real TCP peer) and is independent of it; configuring it makes 'which value is authoritative' ambiguous (У-2)."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "::error::edge client-IP contract broken — see backend/src/lib/rate-limit/client-ip.ts and the header block in deploy/Caddyfile (AUDIT5 §F1b)."
  exit 1
fi
echo "✅ edge client-IP contract intact: app trusts only X-Real-IP, the edge rewrites it on every api upstream + strips inbound values site-wide, no forwarded-chain/hop-count trust, no trusted_proxies (AUDIT5 §F1b, У-1/У-2/У-6)"
