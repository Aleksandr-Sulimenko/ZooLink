#!/usr/bin/env bash
# ADR-0018 Part-2 (D8/D8b) — market-derivation de-coupling gate.
#
# The market of a listing (ADR-0002: pet vs livestock) is derived from its animal's species
# (`species.market`). Wave D3 added a derived, always-consistent `listings.market` cache column
# and D8 repointed EVERY market reader onto it. From here on, NO read-path outside the animal
# aggregate may re-derive the market with a raw `animals ⋈ species` join — that would resurrect the
# tight cross-aggregate coupling ADR-0018 broke and risks cross-market leakage drift (L2-1 no-leak).
#
# The ONLY sanctioned place to reach across the animal aggregate is the animal module itself —
# AnimalService (e.g. the create-path `getOwnedAnimalForActor`, which reads market via a nested
# species select) and the intra-aggregate ownership-transfer flow. That module OWNS the
# animal↔species relationship; the coupling ADR-0018 forbids is *external* modules (listing,
# moderation, schedulers, …) re-deriving the market instead of reading the `listings.market` cache.
#
# SCOPE (D8b): this gate scans ALL of backend/src EXCEPT the animal module ($EXCLUDE_DIR). It thus
# covers listing, moderation AND lib/scheduler (the SLA-escalation scan, previously outside the gate
# and still reading `s.market` via a raw join — now reads `listings.market`). It FAILS (non-zero) on
# any raw `FROM animals` / `JOIN species`. Runnable locally exactly as CI runs it:
#   bash scripts/check-no-raw-market-join.sh
#
# Documented allowed exceptions (a market join was removed but the join still serves a NON-market
# projection): tag the exact line with the marker `grep-allow-market-join` + a reason. Today the
# sole exception is the moderation queue CTE, which keeps `JOIN species` ONLY to project
# `species.code` for display — market on that CTE reads `l.market`.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

SCAN_ROOT="backend/src"
# The animal aggregate is the sanctioned owner of animal↔species (AnimalService + the
# ownership-transfer flow). Its intra-aggregate market reads are legitimate and out of scope.
EXCLUDE_DIR="backend/src/modules/animal"
# Raw market-join fingerprints. `JOIN animals` (bridge for species_id/breed_id animal-column
# filters) is intentionally NOT forbidden — it does not read market.
pattern='FROM[[:space:]]+animals|JOIN[[:space:]]+species'
marker='grep-allow-market-join'

[ -d "$SCAN_ROOT" ] || { echo "::error::scan root not found: $SCAN_ROOT"; exit 2; }

fail=0
# -n line numbers, -E extended regex; each hit is `path:lineno:content`.
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  case "$hit" in
    "$EXCLUDE_DIR"/*) continue ;; # sanctioned animal aggregate — out of scope
  esac
  if grep -qF "$marker" <<<"$hit"; then
    echo "  allowed (marked): $hit"
    continue
  fi
  echo "::error::raw market-join found (use listings.market cache / AnimalService — ADR-0018 D8): $hit"
  fail=1
done < <(grep -rnE "$pattern" "$SCAN_ROOT" --include='*.ts' || true)

if [ "$fail" -ne 0 ]; then
  echo "::error::market must be read from the derived listings.market cache (D3) or via AnimalService — not a raw animals⋈species join. See ADR-0018 Part-2."
  exit 1
fi
echo "✅ no raw market-join outside the animal aggregate — market reads the derived listings.market cache (ADR-0018 D8/D8b)"
