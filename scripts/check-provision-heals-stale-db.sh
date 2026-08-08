#!/usr/bin/env bash
#
# check-provision-heals-stale-db.sh — provisioner-converges-an-AGEING-VOLUME gate.
#
# ── THE INCIDENT this gate is the fix for (found live 2026-08-07) ────────────────────────────────────
# `provision.ts` used to apply database_schema.sql ONLY when the DB was empty and replayed NO
# migrations. So a long-lived compose volume silently froze at the shape it was created with while the
# code moved on. On a five-week-old volume `POST /api/v1/auth/register/phone` returned 500
# `users.email_bidx does not exist` (column added by migration 0028) — while `/health/live`,
# `/health/ready` and `GET /listings` all stayed GREEN, because none of them touch the new columns.
# That is the dangerous shape: schema drift INVISIBLE to every health signal, surfacing only on a
# user-facing write. Nothing in CI could see it, because every CI database is created fresh.
#
# ── WHAT this gate asserts (three axes, all automated — no "checked by hand") ────────────────────────
#  POSITIVE     — a NON-EMPTY, LAGGING database + `npm run db:provision` ⇒ the missing column is back
#                 with the right type/length, its partial index is back, and a register-shaped INSERT
#                 (the exact statement identity.service.ts issues, incl. `email_bidx`) SUCCEEDS.
#  NEGATIVE-1   — the SAME lagging database, run through the REAL pre-fix provisioner (the actual file
#                 from the pinned SHA below, not an imitation), stays broken — and fails for EXACTLY the
#                 right reason: an ANCHORED SQLSTATE 42703 on `users.email_bidx`. Any other SQLSTATE, or
#                 42703 on any other column, is RED. (Do not weaken that to `grep email_bidx`: psql
#                 echoes the failing statement, whose text contains the column name, so a substring
#                 match passes for a completely different missing column — a proven false green.)
#                 The axis also asserts the old provisioner RAN TO COMPLETION, so "column absent" can
#                 never mean "nothing executed".
#  NEGATIVE-2   — the healing step cannot be silently disabled: point the provisioner at an EMPTY
#                 migrations directory (what a dropped `./migrations:/migrations:ro` bind mount looks
#                 like) and it must EXIT NON-ZERO with a loud message, not report success.
#  IDEMPOTENCY  — provisioning the healed database a SECOND time is still green (ВОРОТА: ×2).
#
# ── HOW the lag is simulated ────────────────────────────────────────────────────────────────────────
# Apply the current canon, then reverse migration 0028's user-visible DDL (`users.email_bidx` +
# `idx_users_email_bidx`). That is a faithful stand-in for "volume created before 0028 landed" for the
# purpose of this gate: the code path under test is "does provision restore what the running code
# needs", and the drop reproduces the observed 42703 exactly. Using the real canon (not a frozen old
# copy) also keeps the gate alive as the schema evolves — no snapshot to go stale.
#
# Runs against a THROWAWAY database it creates and drops; never the shared dev/compose DB.
# Requires the backend node_modules (ts-node + pg) — CI does `npm ci` in backend first.
# Local:  cd <repo>; (cd backend && npm ci); bash scripts/check-provision-heals-stale-db.sh
# CI: the `provision-heals-stale-db` job in .github/workflows/ci.yml.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-zoolink}"
export PGPASSWORD="${PGPASSWORD:-zoolink}"
ADMIN_DB="${PGADMIN_DB:-postgres}"
TEST_DB="zoolink_stale_volume_gate"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

DB_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$TEST_DB"

psqla() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -q "$@"; }
psqlt() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" -v ON_ERROR_STOP=1 -qtA "$@"; }

# The pre-fix provisioner, by SHA. NEGATIVE-1 runs the REAL old code, not a re-enactment of it, so the
# axis cannot drift away from what it claims to certify. Pinned (not HEAD~1 / HEAD) precisely because
# HEAD moves: the moment the fix is committed, "HEAD" would BE the fixed version and the negative
# control would silently start proving the opposite of what it says.
PREFIX_SHA="${PROVISION_PREFIX_SHA:-4ed0720}"
PREFIX_TS="$repo_root/backend/.provision-prefix.ts"   # NOT under src/ → outside tsconfig include + eslint glob

work="$(mktemp -d)"
cleanup() {
  psqla -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 || true
  rm -f "$PREFIX_TS"
  rm -rf "$work"
}
trap cleanup EXIT

fail=0
red() { echo "::error::$1"; fail=1; }

# ── the register-shaped INSERT (mirrors identity.service.ts users.create on register/phone) ──────────
# Kept minimal but faithful in the ONE respect that matters: it writes `email_bidx`, exactly like the
# real write path, so a missing column reproduces the production 500.
REGISTER_INSERT="INSERT INTO users (phone_hash, full_name, email, email_bidx, preferred_language, role, principal_type, status)
                 VALUES ('\$2b\$10\$stalegatephonehashphonehashphonehashphonehash', 'Stale Gate Probe',
                         'enc:v1:probe', 'bidxprobe0000000000000000000000000000000000', 'ru',
                         'USER', 'HUMAN', 'PENDING_VERIFICATION');"

# Run a statement and print the verbose psql diagnostic on failure, `OK` on success.
#
# CAUTION for anyone asserting on this output: psql's verbose report includes a `LINE n: …` ECHO of the
# failing statement, so the statement's own text (which mentions email_bidx) appears in the output for
# ANY error in it. A bare `grep email_bidx` therefore matches when a COMPLETELY DIFFERENT column is the
# missing one — a proven false green. Assert with ERR_UNDEFINED_EMAIL_BIDX below, which is anchored to
# the `^ERROR:` line, never with a substring search over the whole blob.
try_sql() {
  local out
  if out=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" -v ON_ERROR_STOP=1 -qtA \
             -c "\set VERBOSITY verbose" -c "$1" 2>&1); then
    echo "OK"
  else
    echo "$out"
  fi
}

# The ONE failure this gate certifies, anchored: SQLSTATE 42703 on users.email_bidx specifically.
ERR_UNDEFINED_EMAIL_BIDX='^ERROR:[[:space:]]+42703:[[:space:]]+column "email_bidx" of relation "users" does not exist'

# SETUP failures must NOT masquerade as gate verdicts. Without this, a run lacking CREATEDB exits 1 —
# byte-identical to "the healing path is broken" — and CI would report a real defect that was never
# measured. Second instance of the same class: the sibling gate check-seed-parity.sh had it too, and
# fixing only one is the "fix landed in two paths of three" trap. Exit >=2 = INCONCLUSIVE, never a verdict.
ensure_test_db() {
  psqla -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1
  if ! psqla -c "CREATE DATABASE $TEST_DB;" >/dev/null 2>&1; then
    echo "::error::SETUP FAILED (INCONCLUSIVE, not a gate verdict) — cannot create the throwaway database '$TEST_DB' as PGUSER=$PGUSER on $PGHOST:$PGPORT. This gate needs a role WITH CREATEDB (CI uses the postgres superuser). Nothing was measured."
    exit 2
  fi
}

build_lagging_db() {
  ensure_test_db
  psqlt -f database_schema.sql >/dev/null
  # Reverse migration 0028's DDL → the DB is now NON-EMPTY (users exists, so provision's guard skips
  # the canon) and BEHIND the code. This is the state the live volume was in.
  psqlt -c "DROP INDEX IF EXISTS idx_users_email_bidx; ALTER TABLE users DROP COLUMN email_bidx;" >/dev/null
  [ "$(psqlt -c "SELECT to_regclass('public.users') IS NOT NULL")" = "t" ] \
    || { echo "::error::setup broken — the simulated stale DB must be NON-EMPTY (public.users present)"; exit 2; }
  [ "$(psqlt -c "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='email_bidx'")" = "0" ] \
    || { echo "::error::setup broken — users.email_bidx should be ABSENT after simulating the lag"; exit 2; }
}

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# NEGATIVE-1 — the PRE-FIX behaviour must stay broken, and for the RIGHT reason
# ════════════════════════════════════════════════════════════════════════════════════════════════════
# Runs the ACTUAL pre-fix provisioner, extracted from the pinned SHA above — not a hand-written
# imitation of it. (An imitation would be behaviourally right today and unfalsifiable tomorrow; the real
# file is the only thing that keeps proving "the old code does not heal".) The alternative — a
# `--skip-migrations` bypass flag in the current provision.ts — was rejected: a switch that turns the fix
# off is a production foot-gun. NEGATIVE-2 covers the accidental-disable case instead.
echo "══ NEGATIVE-1: lagging DB + the REAL pre-fix provisioner (pinned $PREFIX_SHA)"
build_lagging_db

# $DB_URL is the exact string handed to the child. Assert it resolves to the THROWAWAY DB before using
# it: provision.ts/seed.ts both fall back to backend/.env → ../.env for any key not already in the
# environment, so a propagation slip does not fail loudly — it silently retargets a developer's LOCAL
# dev database while the assertions below inspect $TEST_DB, which nothing ever touched. The axis would
# then "pass" because nothing happened. (Guarding on "did rows appear" cannot catch this: the canon
# itself seeds the reference tables, so $TEST_DB already has them.)
reached=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qtAc 'SELECT current_database()' 2>/dev/null || true)
[ "$reached" = "$TEST_DB" ] \
  || { echo "::error::\$DB_URL resolves to '${reached:-<unreachable>}', not the throwaway '$TEST_DB' — refusing to run: every axis below would measure the wrong database."; exit 2; }

git show "$PREFIX_SHA:backend/src/provision.ts" > "$PREFIX_TS" 2>/dev/null \
  || { echo "::error::cannot extract backend/src/provision.ts at $PREFIX_SHA — the pinned pre-fix revision is unreachable (shallow clone? rewritten history?), so NEGATIVE-1 cannot run the real old code. In CI use actions/checkout with fetch-depth sufficient to reach it, or re-pin PROVISION_PREFIX_SHA."; exit 2; }
# Sanity: the pinned revision must really be the PRE-fix one, or this axis is comparing the fix to itself.
if grep -q 'readdirSync' "$PREFIX_TS"; then
  echo "::error::the file at $PREFIX_SHA already replays migrations (it references readdirSync) — PROVISION_PREFIX_SHA points at a POST-fix revision, so NEGATIVE-1 would certify nothing. Re-pin it to the last commit before the migration-replay change."
  exit 2
fi
if ! ( cd backend && DATABASE_URL="$DB_URL" SEED_FORCE=true SCHEMA_FILE="$repo_root/database_schema.sql" \
         npx ts-node .provision-prefix.ts ) > "$work/neg1_prov.log" 2>&1; then
  echo "::error::the PRE-FIX provisioner failed to run at all — NEGATIVE-1 must observe it COMPLETE and still not heal, otherwise 'the column is missing' proves only that nothing executed:"
  tail -15 "$work/neg1_prov.log" | sed 's/^/    /'
  exit 2
fi
grep -q 'provisioning complete' "$work/neg1_prov.log" \
  || { echo "::error::the pre-fix provisioner exited 0 but never reported 'provisioning complete' — it did not run to the end, so NEGATIVE-1 would be vacuous:"; tail -15 "$work/neg1_prov.log" | sed 's/^/    /'; exit 2; }
echo "    (pre-fix run: $(grep -cE '^(✓|  [a-z_]+ )' "$work/neg1_prov.log") progress lines, ended in 'provisioning complete')"

cols=$(psqlt -c "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='email_bidx'")
if [ "$cols" != "0" ]; then
  red "NEGATIVE-1 broken: users.email_bidx reappeared WITHOUT a migration replay ($cols). This axis can no longer prove the drift is real — the canon path must not be healing it."
fi

res="$(try_sql "$REGISTER_INSERT")"
if [ "$res" = "OK" ]; then
  red "NEGATIVE-1 FAILED: the register-shaped INSERT SUCCEEDED on the lagging DB. The negative control is not reproducing the incident, so a green POSITIVE axis would prove nothing."
elif ! grep -qE "$ERR_UNDEFINED_EMAIL_BIDX" <<<"$res"; then
  red "NEGATIVE-1 FAILED: the INSERT failed, but NOT with an anchored '42703 column \"email_bidx\" of relation \"users\" does not exist'. This axis certifies exactly ONE failure mode; any other SQLSTATE, or 42703 on a DIFFERENT column, is red (do NOT relax this to a substring search — psql echoes the failing statement, whose text contains 'email_bidx', so a substring match passes for any error). Got:"
  echo "$res" | head -6 | sed 's/^/    /'
else
  echo "✅ NEGATIVE-1: pre-fix provisioning leaves the volume STALE; register-path INSERT dies with 42703 on email_bidx (the live 500), as required:"
  grep -E "$ERR_UNDEFINED_EMAIL_BIDX" <<<"$res" | head -1 | cut -c1-160 | sed 's/^/    /'
fi

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# POSITIVE — the CURRENT provisioner heals the very same lagging DB
# ════════════════════════════════════════════════════════════════════════════════════════════════════
echo "══ POSITIVE: same lagging DB + npm run db:provision (must heal)"
build_lagging_db
if ! ( cd backend && DATABASE_URL="$DB_URL" SEED_FORCE=true npm run db:provision ) > "$work/prov1.log" 2>&1; then
  red "POSITIVE FAILED: db:provision exited non-zero on a lagging DB."
  tail -25 "$work/prov1.log" | sed 's/^/    /'
else
  grep -E '^(✓|Replaying|Applying|  public base tables)' "$work/prov1.log" | sed 's/^/    /' || true
  # the guard must have SKIPPED the canon (proof the DB really was non-empty, not silently rebuilt)
  grep -q 'skipping schema apply' "$work/prov1.log" \
    || red "POSITIVE suspicious: provision did NOT report skipping the canon, so it may have run the fresh-install path instead of the ageing-volume path this gate is about."

  typ=$(psqlt -c "SELECT data_type||'('||coalesce(character_maximum_length::text,'-')||')' FROM information_schema.columns WHERE table_name='users' AND column_name='email_bidx'")
  [ "$typ" = "character varying(60)" ] \
    || red "POSITIVE FAILED: users.email_bidx is '$typ', expected 'character varying(60)' (migration 0028 / canon shape)."
  idx=$(psqlt -c "SELECT count(*) FROM pg_class WHERE relkind='i' AND relname='idx_users_email_bidx'")
  [ "$idx" = "1" ] || red "POSITIVE FAILED: idx_users_email_bidx was not restored (found $idx)."

  res="$(try_sql "$REGISTER_INSERT")"
  if [ "$res" = "OK" ]; then
    echo "✅ POSITIVE: column + index restored and the register-shaped INSERT SUCCEEDS on the healed volume"
  else
    red "POSITIVE FAILED: the register-shaped INSERT still fails after provisioning:"
    echo "$res" | head -8 | sed 's/^/    /'
  fi

  # ── IDEMPOTENCY (ВОРОТА ×2) ────────────────────────────────────────────────────────────────────
  if ( cd backend && DATABASE_URL="$DB_URL" SEED_FORCE=true npm run db:provision ) > "$work/prov2.log" 2>&1; then
    echo "✅ IDEMPOTENCY: a SECOND db:provision on the healed volume is green"
  else
    red "IDEMPOTENCY FAILED: the second db:provision run on an already-provisioned volume exited non-zero."
    tail -25 "$work/prov2.log" | sed 's/^/    /'
  fi
fi

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# NEGATIVE-2 — the healing step cannot be silently disabled (dropped bind mount)
# ════════════════════════════════════════════════════════════════════════════════════════════════════
# A dropped bind mount has TWO shapes and both must abort: the path is GONE, or the path exists but is
# EMPTY (e.g. an over-mounted empty volume). Testing only one leaves the other free to no-op silently.
echo "══ NEGATIVE-2: unusable MIGRATIONS_DIR (a dropped bind mount) must FAIL LOUD, not no-op"
mkdir -p "$work/empty-migrations"
for case_name in "empty dir:$work/empty-migrations" "missing dir:$work/no-such-migrations-dir"; do
  label="${case_name%%:*}"; dir="${case_name#*:}"
  set +e
  ( cd backend && DATABASE_URL="$DB_URL" SEED_FORCE=true MIGRATIONS_DIR="$dir" \
      npm run db:provision ) > "$work/prov_empty.log" 2>&1
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    red "NEGATIVE-2 ($label) FAILED: provisioning reported SUCCESS with no migrations available. A dropped './migrations:/migrations:ro' bind mount would silently restore the pre-fix behaviour — an ageing volume would drift again with a green log."
    tail -10 "$work/prov_empty.log" | sed 's/^/    /'
  elif ! grep -qiE 'no \*\.sql files|migrations directory not found' "$work/prov_empty.log"; then
    red "NEGATIVE-2 ($label) FAILED: provisioning exited $rc, but not with the expected 'no *.sql files' / 'migrations directory not found' diagnosis — the operator would not know WHY. Got:"
    tail -10 "$work/prov_empty.log" | sed 's/^/    /'
  else
    echo "✅ NEGATIVE-2 ($label): provisioning aborts (exit $rc) with an explicit diagnosis:"
    grep -oiE '(no \*\.sql files|migrations directory not found)[^"]{0,80}' "$work/prov_empty.log" | head -1 | sed 's/^/    /'
  fi
done

echo
# if/else, NOT `[ … ] && echo … || { … exit 1; }`: with a closed stdout (e.g. `… | head -3`) the GREEN
# echo takes EPIPE and the `||` branch fires, reporting RED on a passing gate.
if [ "$fail" -eq 0 ]; then
  echo "✅ provision-heals-stale-db gate GREEN (positive + 2 negative controls + idempotency ×2)"
else
  echo "❌ provision-heals-stale-db gate RED"
  exit 1
fi
