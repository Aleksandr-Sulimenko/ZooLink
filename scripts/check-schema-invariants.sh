#!/usr/bin/env bash
#
# check-schema-invariants.sh — AUDIT5 commit-2 authoritative schema-invariant gate (Р9-B / Р10-B / Q8).
#
# Runs TWO checks against a database that has had database_schema.sql applied to it (a throwaway
# canonical DB in CI — see the `schema-invariants` job — or any DB you point PG* at):
#
#   (1) META-GATE (Q8, canon ⊆ registry): grep database_schema.sql for every DEFINED chk_/uq_/trg_
#       name (CONSTRAINT / CREATE UNIQUE INDEX / CREATE TRIGGER / trigger FUNCTION) and assert each
#       one is listed in scripts/schema-invariants.txt. Adding an invariant to canon WITHOUT
#       registering it is a RED build — this is the guard against a hand-maintained list quietly
#       losing items (lesson-handwritten-worklist-loses-items). To self-test it: add a bogus
#       `CONSTRAINT chk_probe CHECK(true)` to canon and re-run → this gate MUST turn RED.
#
#   (2) EXISTENCE-ASSERT (Р9-B / Р10-B, registry ⊆ applied schema): for every registered name,
#       assert it EXISTS in the applied schema (union of pg_constraint / pg_class-index /
#       pg_trigger / pg_proc). Removing a named invariant from canon AND its migration → the applied
#       schema loses it → RED. This is INDEPENDENT of the migration-drift DDL diff, which is
#       one-sided by construction (both its paths start from database_schema.sql; a canon-only
#       removal cancels out of the diff — reviewer-qa Р-9), so this catches what the diff cannot.
#
# ── Р9-A DEBT (Q7-fallback) ─────────────────────────────────────────────────────────────────────
#   There is NO second, fully-independent reconstruction path to the schema (the ideal Р9-A): the
#   pre-audit baseline is not restorable to convergence (ordering forward-refs + unconditional
#   PostGIS geography with no bridging migration — see AUDIT5/PACK-PROPOSAL.md §Р-9 / Q7 and the
#   header of scripts/schema-invariants.txt). This gate is the accepted Q7-fallback: it verifies
#   SELF-CONSISTENCY (canon ⊆ registry ⊆ applied) rather than two independent paths. Р9-A stays
#   OWED and must be resolved by a dedicated ADR. This gate does NOT catch a canon-only ADD of an
#   UNNAMED object (e.g. a bare `ADD COLUMN` with no constraint) — only Р9-A would; that residue is
#   the debt, recorded, not dissolved.
#
# Connection: standard libpq env — PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE — or pass a
# psql conninfo/URL as $1. Exit 0 = both gates green; exit 1 = a gate is RED.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON="$ROOT/database_schema.sql"
REGISTRY="$ROOT/scripts/schema-invariants.txt"
CONN="${1:-}"           # optional psql conninfo/URL; else rely on PG* env

[ -f "$CANON" ]    || { echo "::error::database_schema.sql not found at $CANON"; exit 1; }
[ -f "$REGISTRY" ] || { echo "::error::registry not found at $REGISTRY"; exit 1; }

psql_q() { psql ${CONN:+"$CONN"} -v ON_ERROR_STOP=1 -qtA "$@"; }

# ── extract the DEFINED chk_/uq_/trg_ names from canon (defining occurrences only — NOT comment
#    mentions; a comment naming a since-removed constraint like chk_animals_breed must not be
#    required to exist). Keep this extraction in lockstep with docs/gen of schema-invariants.txt.
canon_defined_names() {
  {
    grep -oiE 'CONSTRAINT[[:space:]]+(chk_|uq_)[a-z0-9_]+'                          "$CANON" | grep -oiE '(chk_|uq_)[a-z0-9_]+'
    grep -oiE 'ADD[[:space:]]+CONSTRAINT[[:space:]]+(chk_|uq_)[a-z0-9_]+'           "$CANON" | grep -oiE '(chk_|uq_)[a-z0-9_]+'
    grep -oiE 'CREATE[[:space:]]+UNIQUE[[:space:]]+INDEX[[:space:]]+(IF NOT EXISTS[[:space:]]+)?uq_[a-z0-9_]+' "$CANON" | grep -oiE 'uq_[a-z0-9_]+'
    grep -oiE 'CREATE[[:space:]]+TRIGGER[[:space:]]+trg_[a-z0-9_]+'                 "$CANON" | grep -oiE 'trg_[a-z0-9_]+'
    grep -oiE 'CREATE[[:space:]]+(OR REPLACE[[:space:]]+)?FUNCTION[[:space:]]+trg_[a-z0-9_]+' "$CANON" | grep -oiE 'trg_[a-z0-9_]+'
  } | tr '[:upper:]' '[:lower:]' | sort -u
}

# registered names (strip comments + blanks)
registry_names() { grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$REGISTRY" | tr -d '[:blank:]' | sort -u; }

fail=0

# ── (1) META-GATE: canon ⊆ registry ─────────────────────────────────────────────────────────────
unregistered="$(comm -23 <(canon_defined_names) <(registry_names) || true)"
if [ -n "$unregistered" ]; then
  echo "::error::META-GATE (Q8) FAILED — these chk_/uq_/trg_ are DEFINED in database_schema.sql but NOT in scripts/schema-invariants.txt:"
  echo "$unregistered" | sed 's/^/    /'
  echo "  → add them to the registry in the SAME change (see the registry header)."
  fail=1
else
  echo "✅ META-GATE (Q8): every chk_/uq_/trg_ defined in canon is registered ($(canon_defined_names | wc -l | tr -d ' ') names)"
fi

# A stale registry entry that canon no longer defines is a WARNING (not a hard fail) — it just means
# the existence-assert below will (correctly) require it in the applied schema; surface it so the
# registry stays honest.
orphans="$(comm -13 <(canon_defined_names) <(registry_names) || true)"
[ -n "$orphans" ] && { echo "::warning::registry lists names not defined in canon (stale? or applied via migration only):"; echo "$orphans" | sed 's/^/    /'; }

# ── (2) EXISTENCE-ASSERT: registry ⊆ applied schema ─────────────────────────────────────────────
# Load the registry (comment/blank-stripped) into a temp table via \copy, then anti-join the
# catalogs (type-agnostic union — a name may be a constraint, a unique index, a trigger, or a
# trigger function). A missing name = the applied schema lost a registered invariant → RED.
names_file="$(mktemp)"; trap 'rm -f "$names_file"' EXIT
registry_names > "$names_file"
missing="$(psql_q <<SQL 2>/dev/null || true
CREATE TEMP TABLE _reg(n text);
\copy _reg(n) FROM '$names_file'
SELECT n FROM _reg WHERE n <> '' AND NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = _reg.n
  UNION ALL SELECT 1 FROM pg_class   WHERE relkind = 'i' AND relname = _reg.n
  UNION ALL SELECT 1 FROM pg_trigger WHERE tgname  = _reg.n
  UNION ALL SELECT 1 FROM pg_proc    WHERE proname = _reg.n)
ORDER BY n;
SQL
)"

if [ -n "$missing" ]; then
  echo "::error::EXISTENCE-ASSERT (Р9-B/Р10-B) FAILED — these registered invariants are ABSENT from the applied schema:"
  echo "$missing" | sed 's/^/    /'
  echo "  → a named invariant was removed from database_schema.sql (+ migration) without updating the registry, OR the schema under test is not canon-built."
  fail=1
else
  echo "✅ EXISTENCE-ASSERT (Р9-B/Р10-B): all $(registry_names | wc -l | tr -d ' ') registered invariants exist in the applied schema"
fi

[ "$fail" -eq 0 ] && echo "✅ schema-invariants gate GREEN" || { echo "❌ schema-invariants gate RED"; exit 1; }
