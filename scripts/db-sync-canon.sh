#!/usr/bin/env bash
#
# db-sync-canon.sh — resync backend/prisma/schema.prisma FROM THE CANON, never from a dev database.
#
# This is the implementation of `npm run db:sync`. It replaces the old two-command recipe
# (`prisma db pull && prisma generate`), which was a documented instruction that quietly did the
# WRONG thing on every developer machine.
#
# ── THE INCIDENT this script is the fix for (2026-08-07 / 2026-08-08) ───────────────────────────────
# An `ON DELETE RESTRICT` fix landed in two of the three paths it had to land in: `database_schema.sql`
# (the canon) and `migrations/`. The DERIVED artifact `backend/prisma/schema.prisma` stayed yesterday's,
# so CI went RED (its `Prisma schema drift check` builds a database FROM the canon, pulls, and diffs).
# The documented cure — "run `npm run db:sync` and commit" — is what makes this repeatable, because
# `prisma db pull` reads whatever `DATABASE_URL` points at, and on a developer machine that is the
# long-lived DEV database (backend/.env → localhost:5432/zoolink, the compose stack).
#
# ── WHY syncing against the dev database is a FALSE GREEN (measured, not asserted) ──────────────────
# A dev database and a canon-built database are NOT the same shape. The dev DB grew by migration
# replay, so columns sit at the `attnum` a later `ALTER TABLE ADD COLUMN` gave them, while the canon
# puts them where `database_schema.sql` declares them. Prisma introspection emits model fields in
# ordinal-position order, so the two databases yield DIFFERENT schema.prisma files. Measured on
# 2026-08-08 by moving `species.sort_order` to the end of its table (exactly what migration replay
# does) and pulling from both databases:
#     629d628  <   sort_order  Int  @default(0)      (canon-built position)
#     635a635  >   sort_order  Int  @default(0)      (dev/replayed position)
# So a dev-sourced pull writes a file that is correct FOR THE DEV DB. Locally everything then looks
# perfect — `git diff` is clean, the second run is stable — while CI, which builds from the canon,
# stays RED. The developer has no local signal at all. That is the trap: the diff "collapses".
#
# ── WHY the cure lives HERE and not in a document ───────────────────────────────────────────────────
# Verdict of the architect-holder, 2026-08-08, verbatim: «документ, требующий дисциплины, гниёт;
# скрипт, падающий закрыто, — нет» — a document that requires discipline rots; a script that fails
# closed does not. So the runbook only NAMES this command; the guarantee is mechanical.
#
# ── HOW we know the target database was built from the canon ────────────────────────────────────────
# This is the heart of the problem, and the honest answer is: BY CONSTRUCTION, or not at all.
#   * INSPECTION CANNOT TELL THEM APART. The obvious heuristic — "the canon yields a known set of
#     objects, 43 tables" — is BLIND: measured 2026-08-08, the canon-built DB and the drifted DB both
#     report exactly 43 base tables in `public`. Drift here is column ORDER and history, not object
#     count. Detecting it by inspection would require comparing against a canon-built reference
#     database — i.e. building one anyway, which is circular. So no inspection-only check is offered:
#     offering one would be a guess dressed as a gate.
#   * THEREFORE the default mode BUILDS the database itself and its provenance is not in question.
#     When (and only when) a caller supplies a database it built, it must carry the provenance STAMP
#     this script writes — a `COMMENT ON DATABASE` naming the sha256 of the canon it was built from.
#     A database comment lives outside the introspected surface: verified 2026-08-08 that a stamped
#     and an unstamped canon database pull byte-IDENTICAL schema.prisma files, so the stamp can never
#     contaminate the artifact it guards. An unstamped target is REFUSED (non-zero + a message naming
#     the subject), never introspected on trust.
#
# ── MODES (fail-closed; the first that applies wins) ────────────────────────────────────────────────
#   (A) DEFAULT — ephemeral docker database. Starts `zl-sync-<pid>` from the PINNED postgres image
#       (the SAME image tag CI runs, so introspection matches CI byte-for-byte and not merely
#       "closely"), applies the canon, stamps it, pulls, generates the client, and removes the
#       container. Nothing to remember, nothing to configure — a instrument instead of a culture.
#       The host needs no psql at all: the canon is applied with the container's OWN version-matched
#       client via `docker exec` (this repo's host client is psql 14 against a PG 16 canon).
#   (B) FALLBACK — no docker available. Creates a THROWAWAY DATABASE (`zoolink_dbsync_canon_<pid>`)
#       on a reachable PostgreSQL server (PGHOST/PGPORT/PGUSER/PGPASSWORD, repo defaults), applies the
#       canon, stamps, pulls, and DROPS it. Provenance is still by construction — this fallback
#       borrows a server, it does not trust an existing database. It never touches the dev database.
#       Chosen automatically and LOUDLY when the docker daemon is unreachable; if docker IS reachable
#       but the container fails, this script DIES rather than silently degrading.
#   (C) DB_SYNC_URL=<url> — a caller-supplied target (e.g. a CI job that already applied the canon to
#       its service database via mode B). The stamp is verified; an unstamped or wrong-revision
#       database is REFUSED. This is the only mode a human can point at a dev database, and it is
#       exactly the mode that refuses.
#
# ── USAGE ───────────────────────────────────────────────────────────────────────────────────────────
#   npm run db:sync                  # (from backend/) rebuild schema.prisma + client from the canon
#   bash scripts/db-sync-canon.sh    # same, from the repo root
#   bash scripts/db-sync-canon.sh --check
#                                    # CI semantic: pull from a canon DB, then assert the committed
#                                    # schema.prisma already matched (`git diff --exit-code`). This is
#                                    # the SAME code path CI's drift check asserts, runnable locally —
#                                    # one truth, not two.
# Escape hatches deliberately LEFT INTACT (no capability was removed by this script):
#   npm run db:generate  → `prisma generate`, regenerates the client from the COMMITTED schema.prisma
#                          with no database and no docker involved. This is the fast inner loop.
#   npm run db:pull      → raw `prisma db pull` against your own DATABASE_URL, for deliberate
#                          exploration of a live database. It is NOT a way to produce a committable
#                          schema.prisma — that is what this script is for.
#
# ── THE MUTANT that must turn axis 1 RED (recipe, so the premise is checkable, not believed) ────────
#   Copy this script, delete the `require_canon_stamp` call in mode (C), point DB_SYNC_URL at a
#   drifted/dev database: the refusal disappears and the script happily writes a dev-shaped
#   schema.prisma. Run 2026-08-08: refusal gone, exit 0, schema.prisma written with the dev field
#   order — i.e. the check is what stands between the developer and the false green.
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

CANON="$repo_root/database_schema.sql"
SCHEMA_PRISMA="$repo_root/backend/prisma/schema.prisma"

# Pinned to the tag CI's `build-test` job runs (.github/workflows/ci.yml → services.postgres.image).
# Introspection output can depend on the server version, so matching CI here is what makes a green
# local run a real prediction of a green CI run. Keep these two in lockstep.
PG_IMAGE="${DB_SYNC_PG_IMAGE:-postgres:16-alpine}"

STAMP_PREFIX="zoolink-db-sync canon"
DB_NAME="zoolink_canon"
DB_USER="zoolink"

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,80p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "db-sync-canon: unknown argument '$arg' (accepted: --check)" >&2; exit 2 ;;
  esac
done

die() { echo "" >&2; echo "db-sync-canon: $*" >&2; echo "" >&2; exit 1; }
say() { echo "db-sync-canon: $*"; }

[ -f "$CANON" ]        || die "canon not found at $CANON"
[ -f "$SCHEMA_PRISMA" ] || die "prisma schema not found at $SCHEMA_PRISMA"

canon_sha() { sha256sum "$CANON" | cut -d' ' -f1; }
stamp_text() { echo "$STAMP_PREFIX sha256=$(canon_sha) built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; }

# ── A Prisma connection URL is NOT a libpq connection URL ──────────────────────────────────────────
# Prisma carries its own query parameters that libpq REJECTS outright: `?schema=public` (which every
# URL in this repo has, incl. backend/.env and CI's DATABASE_URL) makes psql exit 2 with
# `invalid URI query parameter: "schema"`. Measured 2026-08-08 — before this sanitiser, mode C
# refused every target, legitimate ones included, with a misleading "cannot connect". Strip the
# Prisma-only keys and keep everything libpq does understand (sslmode, connect_timeout, …).
libpq_url() {
  local url="$1" base query kv out=""
  case "$url" in
    *\?*) base="${url%%\?*}"; query="${url#*\?}" ;;
    *) echo "$url"; return 0 ;;
  esac
  local IFS='&'
  # shellcheck disable=SC2086  # deliberate word-splitting on '&' to walk the query parameters
  for kv in $query; do
    case "${kv%%=*}" in
      schema|connection_limit|pool_timeout|pgbouncer|socket_timeout|statement_cache_size|sslidentity|sslpassword) ;;
      *) out="${out:+$out&}$kv" ;;
    esac
  done
  echo "${base}${out:+?$out}"
}

# ── The refusal. The ONLY thing standing between a developer and a false-green commit. ─────────────
# Reads the provenance stamp from the target database and refuses unless it names the CURRENT canon.
require_canon_stamp() {
  local url="$1" stamp expected_sha err
  expected_sha="$(canon_sha)"
  err="$(mktemp)"
  # The connection error is REPORTED, never swallowed: a refusal whose stated reason is wrong is how
  # a gate becomes noise that people route around.
  if ! stamp="$(psql "$(libpq_url "$url")" -tAc \
    "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database()" \
    2>"$err")"; then
    echo "--- psql said: ---" >&2; cat "$err" >&2
    rm -f "$err"
    die "cannot connect to the database in DB_SYNC_URL (psql error above) — provenance UNVERIFIED, so
    nothing was introspected and schema.prisma was left untouched."
  fi
  rm -f "$err"
  stamp="$(echo "$stamp" | tr -d '\r' | sed -e 's/^ *//' -e 's/ *$//')"

  if [ -z "$stamp" ]; then
    die "REFUSING to introspect the database in DB_SYNC_URL: it carries NO canon-provenance stamp.
    Subject: this database may be a DEV database, and \`prisma db pull\` against a dev database is a
    FALSE GREEN. A dev database grew by migration replay, so its column ORDER differs from
    database_schema.sql; the introspected schema.prisma then matches the DEV database, your local
    \`git diff\` looks clean, and CI — which builds its database FROM database_schema.sql — stays RED.
    You would have no local signal that anything is wrong.
    Why this is not decided by inspection: object counts CANNOT tell the two apart (a canon-built and
    a drifted database both report 43 tables here, measured 2026-08-08), so this script trusts only a
    database whose provenance it knows.
    Fix: run \`npm run db:sync\` with DB_SYNC_URL UNSET — the script will build a canon database
    itself (ephemeral docker, or a throwaway database on your PG server) and the question disappears."
  fi

  case "$stamp" in
    "$STAMP_PREFIX sha256=$expected_sha"*) : ;;
    "$STAMP_PREFIX sha256="*)
      die "REFUSING to introspect the database in DB_SYNC_URL: it was built from a DIFFERENT revision
    of database_schema.sql than the one in your working tree.
      its stamp: $stamp
      canon now: sha256=$expected_sha
    Introspecting it would write a schema.prisma derived from a STALE canon — the exact drift this
    gate exists to prevent. Rebuild the target from the current canon, or unset DB_SYNC_URL." ;;
    *)
      die "REFUSING to introspect the database in DB_SYNC_URL: its database comment is not a
    canon-provenance stamp (found: '$stamp'). Unset DB_SYNC_URL to let this script build a canon
    database itself." ;;
  esac
  say "provenance OK — target is stamped for the current canon (sha256=${expected_sha:0:16}…)"
}

# ── Introspect + generate against a URL whose provenance is already established. ───────────────────
# DATABASE_URL is passed in the environment: measured 2026-08-08 that an environment DATABASE_URL
# WINS over backend/.env (prisma's dotenv loading does not override an already-set variable), which is
# what keeps this from silently reading the dev database. Verified by pointing it at an EMPTY
# ephemeral database and getting P4001 "the introspected database was empty" rather than 43 dev models.
pull_and_generate() {
  local url="$1" backup
  backup="$(mktemp)"
  cp "$SCHEMA_PRISMA" "$backup"

  say "introspecting the canon database → backend/prisma/schema.prisma"
  if ! (cd "$repo_root/backend" && DATABASE_URL="$url" npx prisma db pull); then
    cp "$backup" "$SCHEMA_PRISMA"; rm -f "$backup"
    die "prisma db pull FAILED against the canon database — schema.prisma was restored, not left half-written"
  fi
  rm -f "$backup"

  say "regenerating the Prisma client"
  (cd "$repo_root/backend" && DATABASE_URL="$url" npx prisma generate >/dev/null) \
    || die "prisma generate failed"
}

# ── Mode A: ephemeral docker database (default). Provenance by construction. ───────────────────────
CONTAINER=""
cleanup_container() {
  [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}

mode_docker() {
  local pw port url
  CONTAINER="zl-sync-$$"
  pw="dbsync$RANDOM$RANDOM"
  trap cleanup_container EXIT INT TERM

  # Bound to loopback with a random host port: no fixed port to collide with the compose stack, and
  # not reachable off this machine.
  say "starting ephemeral database container $CONTAINER ($PG_IMAGE)"
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$pw" -e POSTGRES_DB="$DB_NAME" \
    -p 127.0.0.1::5432 "$PG_IMAGE" >/dev/null \
    || die "could not start $PG_IMAGE. Docker is reachable, so this is a real failure and NOT
    silently downgraded to the no-docker fallback. Fix the image/daemon, or force the fallback with
    DB_SYNC_NO_DOCKER=1."

  # ── Readiness, and the race it guards against (measured 2026-08-08) ──────────────────────────────
  # `pg_isready` ALONE IS NOT A READINESS GATE for the official postgres image. During `initdb` the
  # entrypoint runs a TEMPORARY server on the unix socket, and pg_isready happily answers YES to it;
  # that server is then shut down and its socket removed before the real one starts. A pg_isready-only
  # gate here passed on the first run and FAILED on the second with
  #   psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed
  # which this script then misreported as "the canon failed to apply". So: wait for the entrypoint to
  # ANNOUNCE that initialisation finished, and only then require a real query to succeed.
  local ready=0
  for _ in $(seq 1 120); do
    if docker logs "$CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete"; then ready=1; break; fi
    if ! docker ps -q --filter "name=^${CONTAINER}$" | grep -q .; then
      docker logs "$CONTAINER" 2>&1 | tail -20 >&2
      die "the ephemeral database container exited during initialisation (logs above)"
    fi
    sleep 0.5
  done
  [ "$ready" = 1 ] || die "ephemeral database never finished initialising (60s)"

  ready=0
  for _ in $(seq 1 120); do
    if [ "$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' 2>/dev/null \
            | tr -d '[:space:]')" = "1" ]; then ready=1; break; fi
    sleep 0.5
  done
  [ "$ready" = 1 ] || die "ephemeral database never accepted a query (60s)"

  say "applying the canon (database_schema.sql) with the container's own psql"
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f - < "$CANON" \
    || die "the canon failed to apply to a FRESH database — that is a defect in database_schema.sql itself"

  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qc \
    "COMMENT ON DATABASE $DB_NAME IS '$(stamp_text)'" >/dev/null

  port="$(docker port "$CONTAINER" 5432/tcp | head -1 | sed 's/.*://')"
  [ -n "$port" ] || die "could not resolve the container's host port"
  url="postgresql://$DB_USER:$pw@127.0.0.1:$port/$DB_NAME?schema=public"

  pull_and_generate "$url"
  cleanup_container
  CONTAINER=""
  trap - EXIT INT TERM
}

# ── Mode B: throwaway database on a reachable server (no docker). Provenance by construction. ──────
THROWAWAY_DB=""
cleanup_throwaway() {
  [ -n "$THROWAWAY_DB" ] && dropdb --if-exists "$THROWAWAY_DB" >/dev/null 2>&1 || true
}

mode_throwaway_db() {
  local url
  export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-zoolink}"
  export PGPASSWORD="${PGPASSWORD:-zoolink}"
  export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

  command -v psql >/dev/null   || die "no docker AND no psql client — cannot build a canon database"
  command -v createdb >/dev/null || die "no docker AND no createdb — cannot build a canon database"

  THROWAWAY_DB="zoolink_dbsync_canon_$$"
  if psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$THROWAWAY_DB'" 2>/dev/null | grep -q 1; then
    THROWAWAY_DB=""
    die "throwaway database name collision — refusing to reuse an existing database (its provenance
    is unknown, which is the whole point). Re-run; the name carries this process's pid."
  fi

  say "creating throwaway canon database $THROWAWAY_DB on $PGHOST:$PGPORT"
  createdb "$THROWAWAY_DB" || { THROWAWAY_DB=""; die "could not create the throwaway database"; }
  trap cleanup_throwaway EXIT INT TERM

  say "applying the canon (database_schema.sql)"
  psql -d "$THROWAWAY_DB" -v ON_ERROR_STOP=1 -q -f "$CANON" \
    || die "the canon failed to apply to a FRESH database — that is a defect in database_schema.sql itself"

  psql -d "$THROWAWAY_DB" -v ON_ERROR_STOP=1 -qc \
    "COMMENT ON DATABASE $THROWAWAY_DB IS '$(stamp_text)'" >/dev/null

  url="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$THROWAWAY_DB?schema=public"
  pull_and_generate "$url"
  cleanup_throwaway
  THROWAWAY_DB=""
  trap - EXIT INT TERM
}

# ── Mode selection ─────────────────────────────────────────────────────────────────────────────────
if [ -n "${DB_SYNC_URL:-}" ]; then
  say "mode C — caller-supplied target; verifying canon provenance before touching schema.prisma"
  command -v psql >/dev/null || die "DB_SYNC_URL needs a psql client to verify the provenance stamp"
  require_canon_stamp "$DB_SYNC_URL"
  pull_and_generate "$DB_SYNC_URL"
elif [ -z "${DB_SYNC_NO_DOCKER:-}" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  say "mode A — ephemeral docker canon database"
  mode_docker
else
  say "mode B — NO DOCKER: falling back to a throwaway database on a reachable PostgreSQL server."
  say "         (provenance is still by construction: this script builds the database it reads)"
  mode_throwaway_db
fi

# ── Result ─────────────────────────────────────────────────────────────────────────────────────────
if [ "$CHECK_ONLY" = 1 ]; then
  if git diff --exit-code -- "$SCHEMA_PRISMA"; then
    say "CHECK OK — the committed schema.prisma already matches a canon-built database"
  else
    die "CHECK FAILED — schema.prisma does NOT match the canon (diff above). The canon and the
    derived Prisma schema have drifted apart: run \`npm run db:sync\` and COMMIT the result.
    CI asserts exactly this, so leaving it is a RED build."
  fi
else
  if git diff --quiet -- "$SCHEMA_PRISMA"; then
    say "DONE — schema.prisma was already in sync with the canon; client regenerated"
  else
    say "DONE — schema.prisma was UPDATED from the canon. Review and COMMIT it:"
    say "       git diff -- backend/prisma/schema.prisma"
  fi
fi
