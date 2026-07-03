#!/usr/bin/env bash
# ADR-0017 (RF data residency; ФЗ-152 ст.18 ч.5) — layer 2 of the 3-layer guardrail.
#
# Fails (non-zero) if any region-bearing value in the PROD deploy config resolves to a region
# outside the approved RF allowlist. Region-bearing = every `*_REGION` assignment (object store,
# and — as they are added — managed-PG / replica / backup / DR-failover / PII-bearing log-sink
# region vars), plus any foreign cloud-region token embedded in an endpoint/host.
#
# SINGLE SOURCE OF TRUTH: the allowlist is extracted from backend/src/config/env.validation.ts
# (the RF_ALLOWED_REGIONS constant) so the runtime refine (layer 1) and this CI gate (layer 2)
# can never diverge. Runnable locally exactly as CI runs it: `bash scripts/check-rf-residency.sh`.
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

if [ "$fail" -ne 0 ]; then
  echo "::error::RF data-residency gate FAILED — a non-RF region is configured for prod (ADR-0017)."
  exit 1
fi
echo "✅ RF data-residency gate passed — all region-bearing prod config is RF-resident."
