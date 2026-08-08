#!/usr/bin/env bash
#
# check-seed-parity.sh — AUDIT5 §F1d (Ф-1) seed↔canon PARITY gate.
#
# ── WHAT it gates ───────────────────────────────────────────────────────────────────────────────────
# The two supported bootstrap paths must carry the SAME REFERENCE DATA, not just the same DDL:
#   Path-1 (canon-only)  = database_schema.sql  +  the seed files `seed.ts` replays
#   Path-2 (with replay) = database_schema.sql  +  ALL migrations/*.sql  +  the same seed
# Path-1 is not hypothetical: it is what CI's build-test, migration-drift Path-1 and schema-invariants
# jobs each build from, and what docs/06-operations/deployment-mvp.md documents as the canonical
# bootstrap. (NOTE: `provision.ts` itself now ALSO replays the migrations on every run, so a deployed
# stack follows Path-2 — which is precisely why the canon must still stand alone: it is the source of
# truth every other consumer reads, and a seed row that exists only in a migration is invisible to it.)
# For every table that any of those artifacts seeds, this gate emits a normalized row manifest from
# both databases and diffs them. Any row present on one side only — or the same key with a different
# body/flag — is a RED build.
#
# ── WHY it exists (the incident it is the fix for) ──────────────────────────────────────────────────
# The sibling `migration-drift` job diffs `pg_dump --schema-only --no-comments`, so seed INSERTs are
# OUTSIDE its field of view entirely — it is Р-9 applied to DATA rather than DDL. That blindness let
# the `saved_search_matched` notification template live ONLY in migration 0037 and never reach the
# canon: a canon-built install (canon + seed; `seed.ts` replays only 0011/0010/0022, never 0030/0037)
# got 22 of 24 templates, notification-writer logged `warn` and returned false, and the whole H4
# saved-search notification loop was silently dead — while every dev machine, built by migration
# replay, looked perfectly healthy (23/23 vs 13 failed). AUDIT5 §F1d, verdict Q5=A.
#
# ── WHY the two lists inside are DERIVED, never hand-maintained ─────────────────────────────────────
#  * the seed-file list is EXTRACTED from backend/src/seed.ts (`SEED_FILES`), the same single-source
#    trick check-rf-residency.sh uses for the region allowlist — so the gate can never test a
#    seed sequence that differs from the one production actually runs;
#  * the seeded-TABLE list is EXTRACTED from the `INSERT INTO …` statements in canon + migrations, so
#    a new reference table is covered the moment someone seeds it, with no registry to forget
#    (the hand-maintained-worklist failure mode).
# Consequence worth knowing: this gate needs no per-table column knowledge either — rows are compared
# as jsonb with the volatile keys removed (see NORMALIZATION below).
#
# ── NORMALIZATION (what is deliberately NOT compared) ───────────────────────────────────────────────
# Surrogate/provenance/timestamp keys (`id`, `created_at`, `updated_at`, `created_by`, `updated_by`,
# `deleted_at`) and every UUID-shaped VALUE are dropped before comparison: they are assigned per
# database and would make the diff noise-only. Everything that carries MEANING — codes, names,
# template subjects/bodies, languages, markets, sort orders, enabled flags, JSONB localizations — is
# compared verbatim. Rows are sorted, so INSERT order is irrelevant.
#
# ── KNOWN LIMITS (measured 2026-08-08, recorded not dissolved) ──────────────────────────────────────
#  (1) ONE-SIDED, like the migration-drift DDL diff (Р-9): BOTH paths start from database_schema.sql, so
#      a seed row that lives ONLY in the canon appears on both sides and cancels out. Verified: adding a
#      canon-only `moderation_reasons` row leaves this gate GREEN. That direction is NOT a defect for a
#      FRESH install (the canon is the source of truth and delivers it), and it is not fixable by a third
#      "DDL-only canon + migrations" path — that path does not converge, because migration 0010 inserts
#      notification_templates whose `language` FK needs the `supported_languages` rows the CANON provides
#      (0010 predates 0011). That failure is itself the proof that the migration set is deliberately NOT
#      seed-self-sufficient — i.e. option A of AUDIT5 §F1d (canon = source of truth) is structural.
#  (2) `ON CONFLICT DO NOTHING` MASKS a canon↔migration VALUE disagreement on the same key: whoever
#      inserts first wins, and the canon always runs first in both paths, so the two agree here even when
#      the artefacts do not. Measured today: `feature_toggles.description` differs between the canon and
#      migrations 0038 / 0039 for `agent_service_auth` and `sale_buyer_confirmation` (text only —
#      is_enabled and rollout_percentage agree, so nothing functional diverges). Catching that class needs
#      an artefact-level comparison and a ruling on which text is canonical — owed, with this address.
#  (3) Numeric surrogate FKs (e.g. `breeds.species_id`) ARE compared, which keeps "breed attached to the
#      wrong species" in coverage. That is safe only because both paths apply the identical canon in the
#      identical order, so the serials match. If a future path is added that inserts reference rows in a
#      different order, exclude numeric `*_id` keys in the manifest or the gate will red spuriously.
#
# ── SELF-TEST (the mutant that must turn this RED) ──────────────────────────────────────────────────
#   delete a seed row from database_schema.sql only (e.g. the `saved_search_matched` ru row) → this
#   gate goes RED with that row on the Path-2 side of the diff. Before the AUDIT5 §F1d fix the same
#   mutant was GREEN everywhere in CI — that blindness IS Ф-1.
#   `SEED_PARITY_SELFTEST=1 bash scripts/check-seed-parity.sh` runs exactly that mutant automatically
#   (on a COPY of the canon; the working tree is never modified) and asserts the gate reds.
#
# Connection: standard libpq env — PGHOST / PGPORT / PGUSER / PGPASSWORD (+ PGADMIN_DB for the
# maintenance DB). Creates and DROPS its own throwaway databases; never touches a shared dev DB.
# Local:  bash scripts/check-seed-parity.sh          CI: the `seed-parity` job in ci.yml.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

CANON="${SEED_PARITY_CANON:-$repo_root/database_schema.sql}"   # overridable for the self-test mutant
SEED_TS="$repo_root/backend/src/seed.ts"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-zoolink}"
export PGPASSWORD="${PGPASSWORD:-zoolink}"
# Idempotent DDL is built out of IF [NOT] EXISTS, so a replay emits hundreds of "already exists,
# skipping" NOTICEs. Silence them: they are the EXPECTED output here and would bury the diff.
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
ADMIN_DB="${PGADMIN_DB:-postgres}"
DB1="zoolink_seedparity_p1"
DB2="zoolink_seedparity_p2"

[ -f "$CANON" ]   || { echo "::error::canonical schema not found at $CANON"; exit 2; }
[ -f "$SEED_TS" ] || { echo "::error::seed runner not found at $SEED_TS"; exit 2; }

# ── SELF-TEST DRIVER (SEED_PARITY_SELFTEST=1): prove the gate can actually RED ──────────────────────
# Builds a MUTANT COPY of the canon with one seed row deleted (the ru `saved_search_matched` row — the
# exact Ф-1 shape), re-runs this same script against it, and asserts a non-zero exit. The working tree
# is never modified. Runs in CI right after the real gate, so "the gate is green" can never mean "the
# gate cannot fail" (the false-green failure mode).
if [ "${SEED_PARITY_SELFTEST:-}" = "1" ]; then
  mut="$(mktemp)"; trap 'rm -f "$mut" "$mut.log"' EXIT
  RU_ANCHOR="('saved_search_matched', 'EMAIL', 'Новое"
  EN_ANCHOR="('saved_search_matched', 'EMAIL', 'A new listing"
  # The row spans 2 lines (values continue on the next). Delete the anchor line + its continuation.
  # NOTE: line-count arithmetic is NOT usable as the guard here — the canon has no trailing newline,
  # so awk's output gains one; assert on CONTENT instead (grep -cF), which is what actually matters.
  awk -v a="$RU_ANCHOR" 'index($0,a){skip=1; next} skip{skip=0; next} {print}' "$CANON" > "$mut"
  if [ "$(grep -cF "$RU_ANCHOR" "$CANON")" != "1" ] \
     || [ "$(grep -cF "$RU_ANCHOR" "$mut")" != "0" ] \
     || [ "$(grep -cF "$EN_ANCHOR" "$mut")" != "1" ]; then
    echo "::error::SELF-TEST could not build its mutant — it must delete exactly the ru 'saved_search_matched' seed row from $CANON and leave the en row intact. The anchor text was changed: update RU_ANCHOR/EN_ANCHOR in this block (do NOT delete the self-test)."
    exit 2
  fi
  echo "→ SELF-TEST: re-running the gate against a canon copy missing 1 seed row (must go RED)"
  set +e
  SEED_PARITY_SELFTEST='' SEED_PARITY_CANON="$mut" bash "$0" > "$mut.log" 2>&1
  rc=$?
  set -e
  # `rc != 0` is NOT sufficient proof. The gate exits 2 for SETUP failures (unreachable PG, dead
  # SEED_FILES extraction, missing seed file, DB-name collision) — accepting those would let the
  # self-test "pass" without the child ever reaching a database, which is a false green about a
  # false-green detector. Demand BOTH the parity exit code (1) and the mutated row in the diff.
  if [ "$rc" -eq 0 ]; then
    echo "::error::SELF-TEST FAILED — the gate stayed GREEN on a canon missing a seed row. It is blind to exactly the AUDIT5 §F1d defect it exists to catch."
    tail -30 "$mut.log"
    exit 1
  fi
  if [ "$rc" -ne 1 ]; then
    echo "::error::SELF-TEST INCONCLUSIVE (child exit $rc, expected 1 = parity failure). Exit ≥2 means the child aborted during SETUP and never compared anything, so this proves nothing about the gate's sensitivity — treated as RED, not as a pass:"
    tail -20 "$mut.log" | sed 's/^/    /'
    exit 1
  fi
  if ! grep -q 'saved_search_matched' "$mut.log"; then
    echo "::error::SELF-TEST INCONCLUSIVE — the gate RED-ed with exit 1, but the diff does not mention the row the mutant removed ('saved_search_matched'), so it red-ed for some OTHER reason and the mutation is not what was detected:"
    tail -20 "$mut.log" | sed 's/^/    /'
    exit 1
  fi
  grep -E "saved_search_matched|SEED↔CANON PARITY FAILED" "$mut.log" | head -5
  echo "✅ SELF-TEST: the gate RED-ed on the mutant (exit 1) with the removed row in the diff — it detects seed drift"
  exit 0
fi

psqla() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -q "$@"; }
psqld() { local d="$1"; shift; psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$d" -v ON_ERROR_STOP=1 -qtA "$@"; }

work="$(mktemp -d)"
cleanup() {
  psqla -c "DROP DATABASE IF EXISTS $DB1;" >/dev/null 2>&1 || true
  psqla -c "DROP DATABASE IF EXISTS $DB2;" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# ── DERIVED LIST 1: the seed files production actually replays (from seed.ts SEED_FILES) ────────────
# Extracted from the array literal, in order. If the extraction yields nothing the gate is broken (it
# would silently compare "canon vs canon+migrations" without any seed) — so that is a hard error.
seed_files() {
  awk '/^const SEED_FILES/,/\];/' "$SEED_TS" | grep -oE "'[^']+\.sql'" | tr -d "'"
}

# ── DERIVED LIST 2: every table any artifact seeds (from the INSERT INTO statements) ────────────────
# Accepts an optional `public.` qualifier and strips it, so `INSERT INTO public.foo` is not silently
# turned into the un-resolvable name `public.foo` (which would be reported ABSENT on BOTH paths and so
# compare equal — a table quietly dropping out of coverage). Names absent from both paths are flagged
# below, so an extraction miss is LOUD rather than a hole.
seeded_tables() {
  grep -ohiE 'INSERT[[:space:]]+INTO[[:space:]]+(public\.)?[a-z_][a-z0-9_]*' "$CANON" migrations/*.sql \
    | awk '{ n = tolower($NF); sub(/^public\./, "", n); print n }' | sort -u
}

# ── LOWER BOUND for the derived list (independent floor, so a broken extraction cannot go GREEN) ─────
# A derived list is only trustworthy if something independent asserts it did not come back empty or
# short. Verified failure mode: mistype the regex (`INTO`→`ONTO`) and the gate reported
# "GREEN — identical reference data (0 rows across 0 seeded tables)". The floor is seed.ts's own
# COUNT_TABLES — a list the seed runner already maintains for its own summary, so this stays
# single-sourced rather than becoming a second hand-kept registry.
count_tables() {
  awk '/^const COUNT_TABLES/,/\];/' "$SEED_TS" | grep -oE "'[a-z_][a-z0-9_]*'" | tr -d "'" | sort -u
}

# ── the normalized row manifest for one database ────────────────────────────────────────────────────
# Per table: each row as jsonb, minus the volatile keys and minus every UUID-shaped value (see the
# NORMALIZATION note in the header). A table missing from a path is reported explicitly rather than
# skipped, so a canon/migration table split cannot hide inside an empty comparison.
VOLATILE="'id','created_at','updated_at','created_by','updated_by','deleted_at'"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

manifest() {
  local db="$1" t
  while read -r t; do
    if [ "$(psqld "$db" -c "SELECT to_regclass('public.$t') IS NOT NULL")" != "t" ]; then
      echo "$t|<TABLE ABSENT FROM THIS PATH>"
      continue
    fi
    psqld "$db" -c "
      SELECT '$t|' || COALESCE(
        (SELECT jsonb_object_agg(k, v)::text
           FROM jsonb_each(to_jsonb(r)) AS e(k, v)
          WHERE k NOT IN ($VOLATILE)
            AND NOT (jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '$UUID_RE')), '{}')
      FROM $t r"
  done < <(seeded_tables) | LC_ALL=C sort
}

# ── build the two paths ─────────────────────────────────────────────────────────────────────────────
sf="$work/seedfiles"; seed_files > "$sf"
[ -s "$sf" ] || { echo "::error::could not extract SEED_FILES from $SEED_TS — the gate would compare without any seed. Fix the extraction (awk on 'const SEED_FILES … ];')"; exit 2; }
echo "→ seed files (from seed.ts): $(tr '\n' ' ' < "$sf")"
echo "→ seeded tables (from INSERT INTO in canon + migrations): $(seeded_tables | tr '\n' ' ')"

floor="$(count_tables)"
[ -n "$floor" ] || { echo "::error::could not extract COUNT_TABLES from $SEED_TS — the derived-table list would have no independent floor and a broken extraction could report GREEN over zero tables. Fix the extraction (awk on 'const COUNT_TABLES … ];')"; exit 2; }
uncovered="$(comm -23 <(printf '%s\n' "$floor") <(seeded_tables) || true)"
if [ -n "$uncovered" ]; then
  echo "::error::the derived seeded-table list does NOT cover every table seed.ts counts — the extraction in seeded_tables() is broken or narrowed, and this gate would compare LESS than it reports (a broken regex previously yielded '0 rows across 0 seeded tables' and still said GREEN). Missing:"
  printf '%s\n' "$uncovered" | sed 's/^/    /'
  exit 2
fi
echo "→ floor OK: all $(printf '%s\n' "$floor" | wc -l | tr -d ' ') tables seed.ts counts are covered by the derived list"

apply_seed() {
  local db="$1" f
  while read -r f; do
    [ -f "migrations/$f" ] || { echo "::error::seed file listed in seed.ts does not exist: migrations/$f"; exit 2; }
    psqld "$db" -f "migrations/$f" >/dev/null
  done < "$sf"
}

# SETUP failures must NOT masquerade as parity failures. Without this, a run lacking CREATEDB
# (or any other setup problem) exits 1 — byte-identical to "the two paths диverged" — and CI would
# report a seed drift that was never measured. Same class the self-test already guards (exit >=2 =
# INCONCLUSIVE, never a verdict); it belonged on the main path too. Found by the acceptance run:
# locally PGUSER=zoolink has no CREATEDB, and the gate red-ed as if parity had failed.
ensure_db() { # $1 = database name
  psqla -c "DROP DATABASE IF EXISTS $1;" >/dev/null 2>&1
  if ! psqla -c "CREATE DATABASE $1;" >/dev/null 2>&1; then
    echo "::error::SETUP FAILED (INCONCLUSIVE, not a parity verdict) — cannot create throwaway database '$1' as PGUSER=$PGUSER on $PGHOST:$PGPORT. The gate needs a role WITH CREATEDB (CI uses the postgres superuser). Nothing was compared."
    exit 2
  fi
}
ensure_db "$DB1"
ensure_db "$DB2"

echo "→ Path-1 (production): canon + seed"
psqld "$DB1" -f "$CANON" >/dev/null
apply_seed "$DB1"

echo "→ Path-2 (replay): canon + all migrations + seed"
psqld "$DB2" -f "$CANON" >/dev/null
for f in migrations/*.sql; do psqld "$DB2" -f "$f" >/dev/null; done
apply_seed "$DB2"

# ── compare ─────────────────────────────────────────────────────────────────────────────────────────
manifest "$DB1" > "$work/path1.seed"
manifest "$DB2" > "$work/path2.seed"

# A name the extraction produced that resolves in NEITHER path is not a divergence (it cancels out of
# the diff) — it means the derived list has an entry that is not a real table, i.e. this gate silently
# covers one table less than it claims. Surface it; do not let it hide inside a green diff.
bogus="$(grep -F '<TABLE ABSENT FROM THIS PATH>' "$work/path1.seed" | cut -d'|' -f1 \
         | grep -Fxf <(grep -F '<TABLE ABSENT FROM THIS PATH>' "$work/path2.seed" | cut -d'|' -f1) || true)"
if [ -n "$bogus" ]; then
  echo "::warning::these names were derived from an INSERT INTO but resolve in NEITHER path — coverage is smaller than reported, fix the extraction in seeded_tables():"
  echo "$bogus" | sed 's/^/    /'
fi

# PER-TABLE lower bound: a table that yields ZERO manifest rows on both paths cancels out of the diff
# exactly like a mis-extracted name, so "the list is complete" is not enough — each table seed.ts counts
# must actually CONTRIBUTE rows. This is what catches the loss of ONE table, which the self-test cannot
# (the self-test only mutates notification_templates, so it proves total blindness, not partial).
empty=""
while read -r t; do
  [ "$(grep -c "^$t|" "$work/path1.seed")" -gt 0 ] || empty="$empty $t"
done <<< "$floor"
if [ -n "$empty" ]; then
  echo "::error::these tables contribute ZERO rows to the Path-1 manifest, so any drift in them is invisible (they cancel out of the diff):$empty"
  echo "  → either the seed no longer populates them (a real regression) or the manifest query is not reaching them."
  exit 2
fi

if diff -u --label "Path-1 (canon + seed  = what a FRESH install gets)" "$work/path1.seed" \
            --label "Path-2 (canon + migrations + seed = what a replay DB gets)" "$work/path2.seed"; then
  echo "✅ seed-parity gate GREEN — both bootstrap paths carry identical reference data ($(wc -l < "$work/path1.seed" | tr -d ' ') rows across $(seeded_tables | wc -l | tr -d ' ') seeded tables)"
  exit 0
fi

cat >&2 <<'MSG'
::error::SEED↔CANON PARITY FAILED (AUDIT5 §F1d). The two bootstrap paths disagree on reference data.
  Read the diff above:  `-` = only a FRESH install has it   `+` = only a REPLAY database has it.
  A `+` line is the Ф-1 shape: a migration seeds a row the canon never mirrors, so the feature is
  dead on every fresh install while every dev machine looks healthy.
  FIX (hierarchy of truth — database_schema.sql is the source of truth for seed data): mirror the row
  into database_schema.sql next to its neighbours, keeping the migration as-is. Do NOT "fix" it by
  adding the migration to seed.ts SEED_FILES — that multiplies seeding patterns (§F1d option B).
MSG
exit 1
