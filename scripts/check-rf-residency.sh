#!/usr/bin/env bash
# ADR-0017 (RF data residency; ФЗ-152 ст.18 ч.5) — layer 2 of the 3-layer guardrail.
#
# Fails (non-zero) if any region-bearing value in the PROD deploy config resolves to a region
# outside the approved RF allowlist. Region-bearing = every `*_REGION` assignment (object store,
# and — as they are added — managed-PG / replica / backup / DR-failover / PII-bearing log-sink
# region vars), plus any foreign cloud-region token embedded in an endpoint/host.
#
# It ALSO fails on a non-RF error/telemetry INGEST HOST (clause 6): `SENTRY_DSN` carries no region
# string at all, so the region axes above are blind to it while it ships PII-bearing stack traces
# abroad — the exact "three green layers, data still leaves" hole this axis closes.
#
# SINGLE SOURCE OF TRUTH: both allowlists are extracted from backend/src/config/env.validation.ts
# (RF_ALLOWED_REGIONS and RF_ALLOWED_TELEMETRY_HOST_SUFFIXES) so the runtime refine (layer 1) and
# this CI gate (layer 2) can never diverge. Runnable locally exactly as CI runs it: `bash scripts/check-rf-residency.sh`.
#
# Layers: runbook pin (doc) -> THIS CI gate (pre-deploy) -> boot refine (runtime). Defense in depth.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

env_validation="backend/src/config/env.validation.ts"
[ -f "$env_validation" ] || { echo "::error::$env_validation not found — cannot derive the RF allowlist"; exit 2; }

# Extract RF_ALLOWED_REGIONS from the single source of truth.
allow="$(sed -n '/RF_ALLOWED_REGIONS = \[/,/\]/p' "$env_validation" \
         | grep -oE "'[a-z0-9-]+'" | tr -d "'" | sort -u)"
[ -n "$allow" ] || { echo "::error::could not parse RF_ALLOWED_REGIONS from $env_validation"; exit 2; }
echo "RF allowlist (from $env_validation): $(echo "$allow" | tr '\n' ' ')"

is_allowed() { grep -qxF "$1" <<<"$allow"; }

# Config files that describe the deployed (prod) topology. Add IaC (terraform/*.tf, helm values,
# k8s manifests) here as they are introduced.
files=()
for f in .env.example docker-compose.yml deploy/Caddyfile; do
  [ -f "$f" ] && files+=("$f")
done
[ "${#files[@]}" -gt 0 ] || { echo "::error::no deploy config files found to scan"; exit 2; }

fail=0

# (1) Every `*_REGION` assignment must be an approved RF region. Handles `KEY=value` (env) and
#     `KEY: value` / `KEY=value` (compose). Comment lines (leading #) are ignored.
while IFS= read -r hit; do
  file="${hit%%:*}"; line="${hit#*:}"
  case "$(echo "$line" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  value="$(echo "$line" | grep -oE '[A-Z0-9_]*_REGION[[:space:]]*[:=][[:space:]]*"?[A-Za-z0-9-]+' \
           | sed -E 's/.*[:=][[:space:]]*"?//' | tr -d '"')"
  [ -n "$value" ] || continue
  if is_allowed "$value"; then
    echo "  ok   $file: *_REGION=$value"
  else
    echo "::error file=$file::region-bearing value '$value' is NOT an approved RF region (ADR-0017 / ФЗ-152 ст.18 ч.5). Allowed: $(echo "$allow" | tr '\n' ' ')"
    fail=1
  fi
done < <(grep -nHE '[A-Z0-9_]*_REGION[[:space:]]*[:=]' "${files[@]}" || true)

# (2) Broad net: any foreign cloud-region token embedded anywhere in prod config (e.g. inside an
#     endpoint/host) is a residency red flag. Matches AWS/GCP/Azure-style `<geo>-<dir>-<n>`.
foreign='\b(us|eu|ap|sa|ca|af|me)-(east|west|central|north|south|southeast|northeast|northwest|southwest|northcentral|southcentral)-[0-9]\b'
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; content="${rest#*:}"
  case "$(echo "$content" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  echo "::error file=$file::foreign cloud-region token in prod config: '$(echo "$content" | grep -oE "$foreign" | head -1)' (ADR-0017 — PII-bearing stores must be RF-resident)"
  fail=1
done < <(grep -nHiE "$foreign" "${files[@]}" || true)

# (3) ADR-0017 clause 6 — the PII-bearing observability sink. `SENTRY_DSN` names a HOST,
#     not a region, so neither (1) nor (2) can see it: a foreign Sentry ingest
#     (`https://<key>@o0.ingest.sentry.io/1`) contains no `*_REGION` and no `us-east-1` token, yet it
#     ships stack traces — and the PII inside them — across the border. EMPTY value = sink disabled
#     (lawful, and the MVP default). Allowlist comes from the SAME single source of truth as the
#     regions: RF_ALLOWED_TELEMETRY_HOST_SUFFIXES in env.validation.ts.
suffixes="$(sed -n '/RF_ALLOWED_TELEMETRY_HOST_SUFFIXES = \[/,/\]/p' "$env_validation" \
            | grep -oE "'\.[^']+'" | tr -d "'" | sort -u)"
[ -n "$suffixes" ] || { echo "::error::could not parse RF_ALLOWED_TELEMETRY_HOST_SUFFIXES from $env_validation"; exit 2; }

# Mirrors isResidentTelemetryHost() in env.validation.ts. Fail-closed: only positively-recognised
# self-hosted (loopback / RFC1918 / IPv6-ULA / single-label service name) or RF-suffixed hosts pass.
telemetry_host_ok() {
  local h
  h="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  h="${h%.}"; h="${h#[}"; h="${h%]}"
  [ -n "$h" ] || return 1
  case "$h" in
    localhost|*.localhost) return 0 ;;
    ::1|0:0:0:0:0:0:0:1) return 0 ;;
    f[cd]*:*|fe80:*) return 0 ;;
    *:*) return 1 ;;                                        # any other IPv6 literal
    127.*|10.*|192.168.*|169.254.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
  esac
  # Any other bare IPv4 literal: residency is unverifiable → refuse.
  case "$h" in [0-9]*.[0-9]*.[0-9]*.[0-9]*) return 1 ;; esac
  case "$h" in *.*) ;; *) return 0 ;; esac                  # single-label = container/LAN name
  while IFS= read -r sfx; do
    case "$h" in *"$sfx") return 0 ;; esac
  done <<<"$suffixes"
  return 1
}

while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; content="${rest#*:}"
  case "$(echo "$content" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  value="$(printf '%s' "$content" \
           | sed -E 's/.*SENTRY_DSN[[:space:]]*[:=][[:space:]]*//' \
           | tr -d "\"'" | sed -E 's/[[:space:]].*$//')"
  if [ -z "$value" ]; then
    echo "  ok   $file: SENTRY_DSN empty (error sink disabled)"
    continue
  fi
  # Fail-CLOSED on a value we cannot read as an http(s) DSN — mirrors the `unparseable` branch of
  # checkTelemetryDsn(). Without this, a garbage value would fall through the single-label rule and
  # the gate would go green on config the boot validator rejects (layer 1 / layer 2 divergence).
  case "$value" in
    http://*|https://*|HTTP://*|HTTPS://*) ;;
    *)
      echo "::error file=$file::SENTRY_DSN is set but is not a parseable http(s) DSN — refusing (fail-closed): an unverifiable error sink cannot be shown to be RF-resident (ADR-0017 п.6). Leave it empty to disable error reporting."
      fail=1; continue ;;
  esac
  # Host only — never echo the DSN itself, it carries a credential. Real URL shape is honoured
  # (scheme, then userinfo up to '@'), because the public key sits BEFORE the host in a DSN.
  host="$(printf '%s' "$value" \
          | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://##; s#^[^/@]*@##; s#[/?\#].*$##; s#:[0-9]+$##')"
  if [ -z "$host" ]; then
    echo "::error file=$file::SENTRY_DSN is set but no ingest host could be extracted — refusing (fail-closed, ADR-0017 п.6)."
    fail=1; continue
  fi
  if telemetry_host_ok "$host"; then
    echo "  ok   $file: SENTRY_DSN host=$host (RF-resident / self-hosted)"
  else
    echo "::error file=$file::error-sink host '$host' is NOT RF-resident (ADR-0017 п.6 / ФЗ-152 ст.18 ч.5) — stack traces carry PII. Allowed: self-hosted (loopback/private/single-label) or $(echo "$suffixes" | tr '\n' ' ')"
    fail=1
  fi
done < <(grep -nHE '(^|[^A-Z0-9_])SENTRY_DSN[[:space:]]*[:=]' "${files[@]}" || true)

if [ "$fail" -ne 0 ]; then
  echo "::error::RF data-residency gate FAILED — a non-RF region is configured for prod (ADR-0017)."
  exit 1
fi
echo "✅ RF data-residency gate passed — all region-bearing prod config is RF-resident."
