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
# ── SECOND SUBJECT: the ARTEFACT-LEVEL check (canon text vs migration text) ─────────────────────────
# The row comparison above cannot see one whole class of disagreement, and the mechanism is worth
# stating precisely: every migration seeds with `ON CONFLICT … DO NOTHING`, and the canon runs FIRST on
# both bootstrap paths, so when the canon and a migration carry DIFFERENT text for the SAME key, the
# migration's INSERT is a silent no-op and BOTH databases end up holding the canon's text. The two
# paths agree perfectly — while the two ARTEFACTS do not. Measured 2026-08-08: `feature_toggles
# .description` differs between the canon and migrations 0038/0039 for `agent_service_auth` and
# `sale_buyer_confirmation`.
# So this gate builds a THIRD state: it replays every migration a second time with each
# `ON CONFLICT (…) DO NOTHING` mechanically rewritten to `ON CONFLICT (…) DO UPDATE SET col=EXCLUDED
# .col, …` (the column list is taken from the INSERT's own column list, so no per-table knowledge is
# needed). That inverts who wins — the MIGRATION's text lands. The row SETS of the two states are
# identical by construction, so their diff isolates exactly the masked class: same natural key,
# different value. Each difference is addressed as `table|key|column`, where the natural key is
# DISCOVERED from the live catalog (smallest unique index carrying no surrogate `id`/uuid column) —
# never hand-listed.
#
# ── the KNOWN-DIVERGENCE REGISTRY, and why it is two-sided ──────────────────────────────────────────
# Not every such disagreement is a defect: a text-only difference that provably cannot reach a database
# may be ruled acceptable (ADR-0007 forbids editing an applied migration, so "make both artefacts
# identical" is not always available). Those rulings live in `scripts/seed-parity-known-divergences.txt`
# — one line `table|key|column|verdict|reason`, verdict and reason REQUIRED, header line required.
# The registry is a list ABOUT A LIVING SYSTEM, so it gets an instrument, or it lies silently. The gate
# asserts BOTH inclusions, and either failure is RED:
#     reality ⊆ registry — an undeclared disagreement fails the build;
#     registry ⊆ reality — an entry that no longer matches a real disagreement fails the build too
#                          ("the registry has gone stale — delete this entry").
# An unreadable/empty/garbled registry is exit 2 (INCONCLUSIVE), never a quiet green: "zero known
# divergences" is written as the header line with no entries under it, which is not the same file as an
# empty one.
#
# ── COVERAGE IS DECLARED IN THE VERDICT, not only here ──────────────────────────────────────────────
# This gate is one-sided BY CONSTRUCTION (limit 1 below), so it prints its own blind spot next to its
# verdict on EVERY outcome — green, red and inconclusive alike (`coverage_note`, armed as an EXIT trap
# so it cannot be forgotten on a new exit path). A doc that records a blind spot is read once; a sensor
# that announces it is read every time it fires.
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
#  (2) The artefact-level check inverts `ON CONFLICT` clauses, so it is blind to an INSERT that
#      deduplicates with `WHERE NOT EXISTS (…)` instead — there is no conflict clause to invert. Today
#      that is `cities` in the canon and in migration 0011 (and `cities` is also the one seeded table with
#      no natural key at all — `id SERIAL` only — so its rows are addressed by a content hash and any
#      disagreement there would surface as a loud unkeyed pair rather than a precise `table|key|column`).
#      Both facts are announced in the coverage line, not just here.
#  (3) Numeric surrogate FKs (e.g. `breeds.species_id`) ARE compared, which keeps "breed attached to the
#      wrong species" in coverage. That is safe only because both paths apply the identical canon in the
#      identical order, so the serials match. If a future path is added that inserts reference rows in a
#      different order, exclude numeric `*_id` keys in the manifest or the gate will red spuriously.
#
# ── SELF-TEST (the mutants that must turn this RED) ─────────────────────────────────────────────────
# `SEED_PARITY_SELFTEST=1 bash scripts/check-seed-parity.sh` re-runs this same script FOUR times, each
# against a deliberately broken COPY of an input (the working tree is never modified), and requires the
# expected RED every time. Every claim this gate makes has a mutant behind it:
#   M1 row loss          — delete the ru `saved_search_matched` seed row from the canon only → RED (this
#                          is the original Ф-1 shape; before the AUDIT5 §F1d fix it was GREEN in all CI).
#   M2 new divergence    — change the canon's `goods_marketplace` description so it no longer matches
#                          migration 0027 → RED "not declared in the registry" (reality ⊄ registry).
#                          Note the ROW check stays green on M2 — proof the artefact check is what fired.
#   M3 stale registry    — add a registry entry for a divergence that does not exist → RED "the registry
#                          has gone stale" (registry ⊄ reality). This is the instrument that keeps the
#                          registry from rotting into an allow-list nobody rechecks.
#   M4 broken registry   — point the gate at an empty file → exit 2, LOUD, never a quiet green.
#
# Connection: standard libpq env — PGHOST / PGPORT / PGUSER / PGPASSWORD (+ PGADMIN_DB for the
# maintenance DB). Creates and DROPS its own throwaway databases; never touches a shared dev DB.
# Local:  bash scripts/check-seed-parity.sh          CI: the `seed-parity` job in ci.yml.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

CANON="${SEED_PARITY_CANON:-$repo_root/database_schema.sql}"   # overridable for the self-test mutant
SEED_TS="$repo_root/backend/src/seed.ts"
# The ruled-acceptable canon↔migration text disagreements. Overridable ONLY so the self-test can point
# the gate at a deliberately broken/stale copy; production always reads the file in the tree.
REGISTRY="${SEED_PARITY_REGISTRY:-$repo_root/scripts/seed-parity-known-divergences.txt}"
REGISTRY_MAGIC='# zoolink seed-parity known-divergence registry v1'

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

# ── COVERAGE: the gate declares its own blind spot NEXT TO ITS VERDICT, on every outcome ─────────────
# Held verdict 2026-08-08: "охват объявляется В ВЕРДИКТЕ САМОГО ГЕЙТА, а не только в доке". Armed as an
# EXIT trap the moment the script starts, BEFORE any branch can exit, so a future exit path cannot
# silently drop it — that is the difference between a rule and a mechanism. English to match every other
# line this script prints (CI logs, grep-stable regardless of locale).
coverage_note() {
  echo ""
  echo "→ COVERAGE (declared in EVERY outcome — green, red or inconclusive; a sensor must name its own blind spot):"
  echo "    I compare canon→migrations. I SEE: a reference row that lives only in a MIGRATION (row check), and a"
  echo "    value that BOTH artefacts carry but carry DIFFERENTLY (artefact check, ON CONFLICT inverted)."
  echo "    I DO NOT SEE a row that lives ONLY IN THE CANON. Both bootstrap paths start from database_schema.sql,"
  echo "    so such a row appears on both sides and cancels out — measured: a canon-only moderation_reasons row"
  echo "    leaves this gate GREEN. That is one-sidedness BY CONSTRUCTION, not a bug to fix here."
  echo "    I ALSO DO NOT SEE a disagreement inside an INSERT that deduplicates with WHERE NOT EXISTS instead of"
  echo "    ON CONFLICT (today: cities) — there is no conflict clause to invert."
}
trap coverage_note EXIT

# ── SELF-TEST DRIVER (SEED_PARITY_SELFTEST=1): prove the gate can actually RED ──────────────────────
# Builds MUTANT COPIES of this gate's inputs, re-runs this same script against each one, and asserts the
# expected RED every time. The working tree is never modified. Runs in CI right after the real gate, so
# "the gate is green" can never mean "the gate cannot fail" (the false-green failure mode). Four mutants,
# one per claim the gate makes — see the SELF-TEST section in the header for what each proves.
if [ "${SEED_PARITY_SELFTEST:-}" = "1" ]; then
  st="$(mktemp -d)"; trap 'coverage_note; rm -rf "$st"' EXIT
  st_fail=0

  # run_mutant <label> <expected-rc> <must-appear-in-log…> — env for the child comes from MUT_ENV_*
  run_mutant() {
    local label="$1" want="$2"; shift 2
    local log="$st/$label.log" rc needle
    echo ""
    echo "→ SELF-TEST $label: re-running the gate against a broken input (must exit $want)"
    set +e
    env SEED_PARITY_SELFTEST='' \
        SEED_PARITY_CANON="${MUT_CANON:-$CANON}" \
        SEED_PARITY_REGISTRY="${MUT_REGISTRY:-$REGISTRY}" \
        bash "$0" > "$log" 2>&1
    rc=$?
    set -e
    # `rc != 0` is NOT sufficient proof. Exit 2 means the child aborted during SETUP (unreachable PG,
    # dead SEED_FILES extraction, missing seed file) and never compared anything — accepting that would
    # be a false green about a false-green detector. So each mutant pins the EXACT exit code it expects
    # AND a phrase that only its own mutation can produce.
    if [ "$rc" -ne "$want" ]; then
      echo "::error::SELF-TEST $label FAILED — child exit $rc, expected $want. $( [ "$rc" -eq 0 ] && echo 'The gate stayed GREEN on a broken input: it is blind to exactly what it claims to catch.' || echo 'A different exit code means it red-ed (or aborted) for some OTHER reason, which proves nothing about this axis.' )"
      tail -25 "$log" | sed 's/^/    /'
      st_fail=1
      return 0
    fi
    for needle in "$@"; do
      if ! grep -qF "$needle" "$log"; then
        echo "::error::SELF-TEST $label INCONCLUSIVE — exit $rc was right, but the output never mentions \"$needle\", so the gate did not red for the reason this mutant creates:"
        tail -25 "$log" | sed 's/^/    /'
        st_fail=1
        return 0
      fi
    done
    { grep -E '::error::|^  ! ' "$log" || true; } | head -4 | cut -c1-160 | sed 's/^/    /'
    echo "  ✅ SELF-TEST $label passed (exit $rc, with the expected evidence in the output)"
  }

  # ── M1: a seed row deleted from the canon only (the original Ф-1 shape) → row check must RED ────────
  M1_CANON="$st/canon-m1.sql"
  RU_ANCHOR="('saved_search_matched', 'EMAIL', 'Новое"
  EN_ANCHOR="('saved_search_matched', 'EMAIL', 'A new listing"
  # The row spans 2 lines (values continue on the next). Delete the anchor line + its continuation.
  # NOTE: line-count arithmetic is NOT usable as the guard here — the canon has no trailing newline,
  # so awk's output gains one; assert on CONTENT instead (grep -cF), which is what actually matters.
  awk -v a="$RU_ANCHOR" 'index($0,a){skip=1; next} skip{skip=0; next} {print}' "$CANON" > "$M1_CANON"
  if [ "$(grep -cF "$RU_ANCHOR" "$CANON")" != "1" ] \
     || [ "$(grep -cF "$RU_ANCHOR" "$M1_CANON")" != "0" ] \
     || [ "$(grep -cF "$EN_ANCHOR" "$M1_CANON")" != "1" ]; then
    echo "::error::SELF-TEST M1 could not build its mutant — it must delete exactly the ru 'saved_search_matched' seed row from $CANON and leave the en row intact. The anchor text was changed: update RU_ANCHOR/EN_ANCHOR in this block (do NOT delete the self-test)."
    exit 2
  fi
  MUT_CANON="$M1_CANON" MUT_REGISTRY="" run_mutant M1-row-loss 1 'saved_search_matched'

  # ── M2: canon text changed so it no longer matches migration 0027 → NEW undeclared divergence ───────
  # `goods_marketplace` is seeded identically by the canon and by migration 0027 today, so perturbing the
  # canon's copy manufactures exactly one canon↔migration disagreement that the registry does not list.
  # The ROW check stays GREEN on this mutant (both paths apply the mutated canon first), which is what
  # makes it a clean probe of the ARTEFACT check specifically.
  M2_CANON="$st/canon-m2.sql"
  M2_ANCHOR="('goods_marketplace', 'Маркетплейс товаров"
  sed "s/$M2_ANCHOR/('goods_marketplace', 'SELFTEST-M2-PERTURBED товаров/" "$CANON" > "$M2_CANON"
  if [ "$(grep -cF "$M2_ANCHOR" "$CANON")" != "1" ] || [ "$(grep -cF 'SELFTEST-M2-PERTURBED' "$M2_CANON")" != "1" ]; then
    echo "::error::SELF-TEST M2 could not build its mutant — it must alter exactly the canon's 'goods_marketplace' feature_toggles description (which migration 0027 mirrors verbatim). The anchor text was changed: update M2_ANCHOR (do NOT delete the self-test)."
    exit 2
  fi
  MUT_CANON="$M2_CANON" MUT_REGISTRY="" \
    run_mutant M2-new-divergence 1 'NOT DECLARED in the known-divergence registry' \
                                   'feature_toggles|goods_marketplace|description'

  # ── M3: a registry entry describing a divergence that does not exist → the STALENESS instrument ─────
  # This is the mutant that makes the registry a two-sided contract instead of an allow-list nobody
  # rechecks. Without it, the entries here would silently outlive the divergences they describe.
  M3_REG="$st/registry-m3.txt"
  cp "$REGISTRY" "$M3_REG"
  printf '%s\n' "feature_toggles|selftest_m3_ghost|description|SELF-TEST M3 (not a real verdict)|deliberately bogus entry: no such divergence exists, the gate must notice that the registry has gone stale and red" >> "$M3_REG"
  MUT_CANON="" MUT_REGISTRY="$M3_REG" \
    run_mutant M3-stale-registry 1 'registry has gone STALE' \
                                   'feature_toggles|selftest_m3_ghost|description'

  # ── M4: an unreadable registry → exit 2, LOUD; an empty file must never read as "nothing known" ─────
  M4_REG="$st/registry-m4.txt"
  : > "$M4_REG"
  MUT_CANON="" MUT_REGISTRY="$M4_REG" \
    run_mutant M4-broken-registry 2 'known-divergence registry is unusable'

  echo ""
  if [ "$st_fail" -ne 0 ]; then
    echo "::error::SELF-TEST SUITE FAILED — at least one mutant did not produce the RED it must. This gate's verdicts cannot be trusted until that is fixed."
    exit 1
  fi
  echo "✅ SELF-TEST SUITE: all 4 mutants RED-ed as required (row loss, undeclared divergence, stale registry, broken registry)"
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
# coverage_note LAST so the blind-spot declaration is the final thing on screen next to the verdict.
trap 'cleanup; coverage_note' EXIT

# ── THE KNOWN-DIVERGENCE REGISTRY: parse + validate BEFORE spending a second on databases ───────────
# Read strictly. Every rejection below is exit 2 (INCONCLUSIVE — the gate cannot know what is allowed,
# so it must not pretend to have measured anything), and every rejection names the offending line.
# The version header is load-bearing, not decoration: it is what makes an EMPTY or truncated file fail
# LOUDLY. "Zero known divergences" is the header line with nothing under it — a different file entirely
# from a zero-byte one, and the gate can tell them apart.
declared="$work/registry.declared"
reg_bad=0
reg_reject() { echo "::error::the known-divergence registry is unusable ($REGISTRY): $1"; reg_bad=1; }

[ -f "$REGISTRY" ] && [ -r "$REGISTRY" ] \
  || reg_reject "file missing or unreadable. It is a required input, not an optional one — without it the gate cannot tell an ALLOWED canon↔migration text difference from a new defect."
if [ "$reg_bad" -eq 0 ]; then
  reg_first="$(grep -m1 -v '^[[:space:]]*$' "$REGISTRY" || true)"
  [ "$reg_first" = "$REGISTRY_MAGIC" ] \
    || reg_reject "the first non-blank line must be EXACTLY '$REGISTRY_MAGIC' (found: '${reg_first:-<file is empty>}'). An empty, truncated or foreign file fails here BY DESIGN rather than reading as 'nothing is known'."
fi
if [ "$reg_bad" -eq 0 ]; then
  : > "$declared"
  reg_lineno=0
  while IFS= read -r reg_line || [ -n "$reg_line" ]; do
    reg_lineno=$((reg_lineno + 1))
    reg_stripped="${reg_line#"${reg_line%%[![:space:]]*}"}"      # left-trim, to catch indented comments
    case "$reg_stripped" in ''|'#'*) continue ;; esac
    # With IFS='|' the LAST variable absorbs the remainder including any further '|', so a reason
    # containing a pipe is preserved rather than silently splitting into a 6th phantom field.
    IFS='|' read -r r_tbl r_key r_col r_verdict r_reason <<< "$reg_stripped"
    case "$r_tbl" in
      [a-z_]*) [ "${r_tbl//[!a-z0-9_]/}" = "$r_tbl" ] || reg_reject "line $reg_lineno: table '$r_tbl' is not a bare lowercase identifier (no 'public.' qualifier, no quoting)" ;;
      *)       reg_reject "line $reg_lineno: table '$r_tbl' is not a bare lowercase identifier" ;;
    esac
    [ -n "$r_key" ] || reg_reject "line $reg_lineno: empty key. Multi-column natural keys are joined with ':' in unique-index order."
    [ -n "$r_col" ] && [ "${r_col//[!a-z0-9_]/}" = "$r_col" ] \
      || reg_reject "line $reg_lineno: column '$r_col' is not a bare lowercase identifier"
    [ "${#r_verdict}" -ge 8 ] \
      || reg_reject "line $reg_lineno: the verdict field is missing or too short ('$r_verdict'). Every entry must record WHO allowed this divergence and WHEN — an entry nobody signed is how an allow-list becomes a cargo cult."
    [ "${#r_reason}" -ge 20 ] \
      || reg_reject "line $reg_lineno: the reason field is missing or shorter than 20 chars. Every entry must say WHY the divergence is allowed and name the other artefact, or in a month nobody will be able to re-derive the ruling."
    printf '%s|%s|%s\n' "$r_tbl" "$r_key" "$r_col" >> "$declared"
  done < "$REGISTRY"
  if [ -s "$declared" ]; then
    reg_dupes="$(LC_ALL=C sort "$declared" | uniq -d)"
    [ -z "$reg_dupes" ] || reg_reject "duplicate entries for the same table|key|column — deleting one of them would look like a fix while the other kept the divergence allowed: $(printf '%s' "$reg_dupes" | tr '\n' ' ')"
    LC_ALL=C sort -u -o "$declared" "$declared"
  fi
fi
[ "$reg_bad" -eq 0 ] || exit 2
echo "→ known-divergence registry: $(wc -l < "$declared" | tr -d ' ') declared entr$( [ "$(wc -l < "$declared" | tr -d ' ')" = "1" ] && echo y || echo ies) read from ${REGISTRY#"$repo_root/"}"

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

# ── ARTEFACT-LEVEL comparison, part 1: the NATURAL KEY of a table, discovered from the live catalog ──
# The smallest unique index that contains no surrogate `id` column and no uuid column — i.e. the columns
# a human would call "the key" (feature_toggles→key, notification_templates→name,type,language,
# health_certifications→market,code). Partial and expression indexes are excluded (they do not identify
# every row), and INCLUDE columns are not key columns. Discovered, never hand-listed, so this cannot
# drift from the schema. Empty result = the table has no natural key (today: cities, id SERIAL only).
natural_key() { # $1 = db, $2 = table  →  comma-separated column list, or empty
  psqld "$1" -c "
    WITH uidx AS (
      SELECT i.indexrelid, array_agg(a.attname ORDER BY u.ord) AS cols
        FROM pg_index i
        CROSS JOIN unnest(i.indkey::smallint[]) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = u.attnum
       WHERE i.indrelid = to_regclass('public.$2') AND i.indisunique AND i.indisvalid
         AND i.indpred IS NULL AND i.indnatts = i.indnkeyatts AND 0 <> ALL (i.indkey::smallint[])
       GROUP BY i.indexrelid
    )
    SELECT array_to_string(cols, ',') FROM uidx
     WHERE NOT EXISTS (
       SELECT 1 FROM unnest(cols) AS c
         JOIN pg_attribute a2 ON a2.attrelid = to_regclass('public.$2') AND a2.attname = c
        WHERE c = 'id' OR a2.atttypid = 'uuid'::regtype)
     ORDER BY cardinality(cols), array_to_string(cols, ',') LIMIT 1"
}

# ── ARTEFACT-LEVEL comparison, part 2: a per-COLUMN manifest addressed table|key|column ─────────────
# One line per (table, natural key, column) so a difference names itself precisely and the registry can
# address it without knowing any table's shape. The key expression is CACHED per table: both sides of
# this comparison MUST be addressed identically, and caching makes that structural instead of a hope.
# Newlines/tabs inside values (notification body_template is multi-line) are folded to a space — a
# line-oriented diff over multi-line values would otherwise misalign and report noise.
# A table with no natural key falls back to a content hash of the whole row: a divergence there cannot
# be reported as one changed column, it surfaces as an unmatched pair on both sides — louder and less
# precise, which is the correct direction to fail in.
colmanifest() { # $1 = db  →  lines of  table|key|column|value
  local db="$1" t cols kexpr excl c keyfile
  mkdir -p "$work/keys"
  while read -r t; do
    [ "$(psqld "$db" -c "SELECT to_regclass('public.$t') IS NOT NULL")" = "t" ] || continue
    keyfile="$work/keys/$t"
    [ -f "$keyfile" ] || natural_key "$db" "$t" > "$keyfile"
    cols="$(cat "$keyfile")"
    if [ -n "$cols" ]; then
      kexpr="concat_ws(':'"; excl=""
      local karr=()
      IFS=',' read -r -a karr <<< "$cols"
      for c in "${karr[@]}"; do kexpr="$kexpr, r.\"$c\"::text"; excl="$excl,'$c'"; done
      kexpr="$kexpr)"; excl="${excl#,}"
    else
      kexpr="'nokey:' || md5(to_jsonb(r)::text)"; excl="''"
    fi
    psqld "$db" -c "
      SELECT '$t|' || ($kexpr) || '|' || e.k || '|' ||
             regexp_replace(COALESCE(e.v #>> '{}', '<NULL>'), '[\n\r\t]+', ' ', 'g')
        FROM $t r, jsonb_each(to_jsonb(r)) AS e(k, v)
       WHERE e.k NOT IN ($VOLATILE) AND e.k NOT IN ($excl)
         AND NOT (jsonb_typeof(e.v) = 'string' AND (e.v #>> '{}') ~ '$UUID_RE')"
  done < <(seeded_tables) | LC_ALL=C sort
}

# ── ARTEFACT-LEVEL comparison, part 3: invert who wins the ON CONFLICT ──────────────────────────────
# Rewrites every `ON CONFLICT (…) DO NOTHING` / `ON CONFLICT ON CONSTRAINT … DO NOTHING` into a
# `DO UPDATE SET col=EXCLUDED.col, …` built from the INSERT's OWN column list — so no per-table column
# knowledge lives here either. Comment lines are skipped (several migrations discuss `ON CONFLICT DO
# NOTHING` in prose). A conflict clause with NO target is left alone: `DO UPDATE` requires one, and a
# rewrite that produced invalid SQL would abort the run instead of measuring. Verified 2026-08-08: every
# real clause in the tree carries a target and sits on one line with its DO NOTHING.
upsert_rewrite() { # stdin → stdout
  awk '
    { line = $0
      s = line; sub(/^[ \t]*/, "", s)
      if (s ~ /^--/) { print line; next }
      if (match(line, /INSERT[ \t]+INTO[ \t]+[A-Za-z_][A-Za-z0-9_.]*[ \t]*\(/)) {
        rest = substr(line, RSTART); depth = 0; cols = ""
        for (i = index(rest, "("); i <= length(rest); i++) {
          ch = substr(rest, i, 1)
          if (ch == "(") { depth++; if (depth == 1) continue }
          if (ch == ")") { depth--; if (depth == 0) break }
          cols = cols ch
        }
        n = split(cols, arr, ","); setc = ""
        for (j = 1; j <= n; j++) { c = arr[j]; gsub(/[ \t]/, "", c); if (c == "") continue
          setc = setc (setc == "" ? "" : ", ") c "=EXCLUDED." c }
        pending = setc
      }
      if (pending != "" && line ~ /DO[ \t]+NOTHING/ \
          && (line ~ /ON[ \t]+CONFLICT[ \t]*\(/ || line ~ /ON[ \t]+CONFLICT[ \t]+ON[ \t]+CONSTRAINT/)) {
        sub(/DO[ \t]+NOTHING/, "DO UPDATE SET " pending, line); pending = ""
      }
      print line }'
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

# ── SUBJECT 2: ARTEFACT-LEVEL check — canon text vs migration text, reconciled against the registry ──
# Built by mutating DB2 IN PLACE, deliberately: its row manifest is already captured above, and the
# state we need differs from it by exactly one thing — who wins a key both artefacts define. Replaying
# the ON-CONFLICT-inverted migrations over the very same database guarantees the two sides are identical
# in every other respect (same DDL, same serials, same table set), which is what makes the diff
# below mean "the artefacts disagree" and nothing else.
echo "→ Artefact-level: replaying the migrations with ON CONFLICT inverted (migration text wins) …"
colmanifest "$DB2" > "$work/path2.col"

mkdir -p "$work/upsert"
for f in migrations/*.sql; do
  # shellcheck disable=SC2094  # input and output are different files (migrations/ vs $work/upsert/)
  upsert_rewrite < "$f" > "$work/upsert/${f##*/}"
done
# The rewrite is the whole instrument: if it silently rewrote NOTHING, the two sides would be identical
# and this check would report a serene GREEN over zero coverage — the exact false-green shape that a
# broken `INSERT INTO` regex already produced once in this file's history. So count both sides
# independently and demand they agree. `expect` counts non-comment lines that carry both a targeted
# ON CONFLICT and a DO NOTHING; `got` counts the clauses actually produced.
expect_rw="$( { grep -hE 'ON[[:space:]]+CONFLICT' migrations/*.sql || true; } | { grep -vE '^[[:space:]]*--' || true; } \
              | { grep -E 'DO[[:space:]]+NOTHING' || true; } \
              | { grep -cE 'ON[[:space:]]+CONFLICT[[:space:]]*\(|ON[[:space:]]+CONFLICT[[:space:]]+ON[[:space:]]+CONSTRAINT' || true; } )"
got_rw="$( { grep -hoF 'DO UPDATE SET' "$work/upsert"/*.sql || true; } | wc -l | tr -d ' ')"
expect_rw="${expect_rw:-0}"; got_rw="${got_rw:-0}"
if [ "$expect_rw" -lt 1 ] || [ "$got_rw" != "$expect_rw" ]; then
  echo "::error::SETUP FAILED (INCONCLUSIVE, not a verdict) — the ON CONFLICT → DO UPDATE rewrite produced $got_rw clauses where $expect_rw were expected. Without a working rewrite the artefact-level check compares a database against itself and reports GREEN over nothing. Likely cause: an INSERT whose column list is no longer on the same line as 'INSERT INTO', or a conflict clause split across lines — fix upsert_rewrite(), do not delete this guard."
  exit 2
fi
for f in migrations/*.sql; do
  if ! psqld "$DB2" -f "$work/upsert/${f##*/}" >/dev/null; then
    echo "::error::SETUP FAILED (INCONCLUSIVE, not a verdict) — the ON-CONFLICT-inverted replay of ${f##*/} errored, so the artefact-level comparison never happened. Nothing was measured on this axis."
    exit 2
  fi
done
colmanifest "$DB2" > "$work/path3.col"

# Print ONE divergence so a human can act on it. Printing two 400-character reference descriptions whole
# is not a report — the differing words are usually far inside the string and both lines look identical
# when the terminal truncates them (observed on the very first acceptance run of this gate). So locate
# the FIRST differing byte with cmp and show a window around it in each version.
report_divergence() { # $1 = table|key|column
  local tri="$1" canonval migval off_b off_c start
  canonval="$( { grep -F -m1 "< $tri|" "$work/artefact.diff" || true; } | cut -d'|' -f4-)"
  migval="$(   { grep -F -m1 "> $tri|" "$work/artefact.diff" || true; } | cut -d'|' -f4-)"
  printf '%s' "$canonval" > "$work/cmp.a"
  printf '%s' "$migval"   > "$work/cmp.b"
  off_b="$( { cmp "$work/cmp.a" "$work/cmp.b" 2>/dev/null || true; } | sed -nE 's/.*(char|byte) ([0-9]+).*/\2/p' | head -1)"
  off_b="${off_b:-1}"
  # cmp counts BYTES; bash substring counts CHARACTERS. These reference texts are mostly Cyrillic (2
  # bytes per char in UTF-8), so using the byte offset directly would place the window ~2× too far and
  # print two identical-looking excerpts — the exact failure this function exists to fix. Convert.
  off_c="$(head -c "$off_b" "$work/cmp.a" 2>/dev/null | wc -m | tr -d ' ')"
  off_c="${off_c:-1}"
  start=$(( off_c > 45 ? off_c - 45 : 0 ))
  echo "      first differ at char $off_c of the value; window around it:"
  echo "        canon     …${canonval:$start:150}…"
  echo "        migration …${migval:$start:150}…"
}

art_rc=0
diff "$work/path2.col" "$work/path3.col" > "$work/artefact.diff" || true
observed="$work/observed.triples"
{ grep -E '^[<>][[:space:]]' "$work/artefact.diff" || true; } \
  | sed -E 's/^[<>][[:space:]]//' | cut -d'|' -f1-3 | LC_ALL=C sort -u > "$observed"

undeclared="$(LC_ALL=C comm -23 "$observed" "$declared" || true)"
stale="$(LC_ALL=C comm -13 "$observed" "$declared" || true)"

if [ -n "$undeclared" ]; then
  art_rc=1
  echo "::error::CANON↔MIGRATION TEXT DISAGREEMENT that is NOT DECLARED in the known-divergence registry."
  echo "  These reference values differ between database_schema.sql and a migration. Today the difference"
  echo "  is INVISIBLE in any database (the canon runs first and the migration's INSERT is ON CONFLICT DO"
  echo "  NOTHING), which is exactly why it needs a ruling instead of silence — the two artefacts have"
  echo "  stopped being the same contract:"
  while IFS= read -r tri; do
    [ -n "$tri" ] || continue
    echo "  ! $tri"
    report_divergence "$tri"
  done <<< "$undeclared"
  echo "  FIX (preferred): make the CANON right — database_schema.sql is the source of truth for seed data."
  echo "  If the canon is already right and the applied migration must not be touched (ADR-0007), declare the"
  echo "  divergence in ${REGISTRY#"$repo_root/"} with a verdict and a reason. Do not add an entry just to"
  echo "  silence this: an entry is a claim that someone with the authority ruled the canon canonical."
fi

if [ -n "$stale" ]; then
  art_rc=1
  echo "::error::the known-divergence registry has gone STALE — these entries no longer describe an existing divergence:"
  while IFS= read -r tri; do
    [ -n "$tri" ] || continue
    echo "  ! registry entry '$tri' no longer describes an existing divergence — delete it from ${REGISTRY#"$repo_root/"}"
  done <<< "$stale"
  echo "  Either the canon and the migration now agree (someone fixed it — good, the entry has done its job"
  echo "  and must go), or the row/column/key it names was renamed or removed. A registry that is only ever"
  echo "  checked in one direction rots into an allow-list nobody rechecks, so this is RED, not a warning."
fi

if [ "$art_rc" -eq 0 ]; then
  echo "✅ artefact-level check GREEN — $(wc -l < "$work/path2.col" | tr -d ' ') reference values compared between canon and migrations; the only text disagreements are the $(wc -l < "$declared" | tr -d ' ') declared in the registry, and every declared entry still corresponds to a real one"
fi

# ── SUBJECT 1 verdict: the row-level parity diff ─────────────────────────────────────────────────────
row_rc=0
if diff -u --label "Path-1 (canon + seed  = what a FRESH install gets)" "$work/path1.seed" \
            --label "Path-2 (canon + migrations + seed = what a replay DB gets)" "$work/path2.seed"; then
  echo "✅ seed-parity gate GREEN — both bootstrap paths carry identical reference data ($(wc -l < "$work/path1.seed" | tr -d ' ') rows across $(seeded_tables | wc -l | tr -d ' ') seeded tables)"
else
  row_rc=1
  cat >&2 <<'MSG'
::error::SEED↔CANON PARITY FAILED (AUDIT5 §F1d). The two bootstrap paths disagree on reference data.
  Read the diff above:  `-` = only a FRESH install has it   `+` = only a REPLAY database has it.
  A `+` line is the Ф-1 shape: a migration seeds a row the canon never mirrors, so the feature is
  dead on every fresh install while every dev machine looks healthy.
  FIX (hierarchy of truth — database_schema.sql is the source of truth for seed data): mirror the row
  into database_schema.sql next to its neighbours, keeping the migration as-is. Do NOT "fix" it by
  adding the migration to seed.ts SEED_FILES — that multiplies seeding patterns (§F1d option B).
MSG
fi

# Both subjects always report; the exit code is their union so neither can mask the other.
[ "$row_rc" -eq 0 ] && [ "$art_rc" -eq 0 ] || exit 1
exit 0
