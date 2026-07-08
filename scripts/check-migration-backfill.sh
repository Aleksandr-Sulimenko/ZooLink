#!/usr/bin/env bash
# AUDIT4 P2-3 — migration BACKFILL-on-populated-data gate.
#
# The sibling `migration-drift` CI job (ci.yml) replays every migration on a fresh canonical schema
# with ZERO rows, then DDL-diffs. That proves DDL idempotency + schema convergence — real value — but
# it CANNOT prove the DATA path of a "backfill-then-SET NOT NULL" migration: on an empty table the
# backfill UPDATE touches 0 rows and the constraint trivially succeeds, so a wrong/missing backfill
# would still go green (reviewer-qa B1, masking).
#
# This gate closes that hole. For each backfill migration it:
#   (1) applies the canonical schema (final shape),
#   (2) SIMULATES the pre-migration state by dropping the backfilled column(s),
#   (3) SEEDS representative rows carrying the SOURCE data,
#   (4) REPLAYS the migration TWICE (backfill runs against real rows; second pass proves idempotency
#       on POPULATED data — the exact case the empty-table gate can't reach),
#   (5) ASSERTS the backfill produced the correct value + the NOT NULL constraint holds.
#
# Covered: 0033 (listings.market ← animals⋈species), 0032 (favorites.offering_id ← listing_id;
# saved_searches.offering_type default), 0036 (consents.seq monotonic backfill on populated rows).
# 0028's backfill is a TS companion (prisma/backfill/0028_*.ts), not SQL — out of scope for a SQL gate.
#
# Runs against a THROWAWAY database it creates and drops (never the shared dev DB). Local:
#   bash scripts/check-migration-backfill.sh
# CI wires it exactly like the migration-drift job (see .github/workflows/ci.yml).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-zoolink}"
export PGPASSWORD="${PGPASSWORD:-zoolink}"
ADMIN_DB="${PGADMIN_DB:-postgres}"
TEST_DB="zoolink_backfill_gate"

psqla() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -q "$@"; }
psqlt() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" -v ON_ERROR_STOP=1 -q "$@"; }
# Resolve a migration file by its 4-digit number (e.g. 0033) — order-stable, name-independent.
mig() { local f; f=$(ls migrations/*_"$1"_*.sql 2>/dev/null | head -1); [ -n "$f" ] || { echo "::error::migration $1 not found"; exit 2; }; echo "$f"; }

cleanup() { psqla -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ creating throwaway DB $TEST_DB and applying canonical schema"
cleanup
psqla -c "CREATE DATABASE $TEST_DB;"
psqlt -f database_schema.sql >/dev/null

# ── 0033: listings.market backfilled from the animal's species on POPULATED data ────────────────────
echo "→ 0033 listings.market — seed livestock listing, drop column, replay ×2, assert backfill"
psqlt >/dev/null <<'SQL'
-- Simulate pre-0033: the derived-market column did not yet exist.
ALTER TABLE listings DROP COLUMN market CASCADE;
INSERT INTO users (id, full_name, role, principal_type, status, is_active)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'BackfillSeller', 'USER', 'HUMAN', 'ACTIVE', true);
INSERT INTO species (id, code, name_localized, market)
  VALUES (990001, 'bf_cattle', '{"en":"Cattle","ru":"КРС"}', 'livestock');
INSERT INTO animals (id, owner_id, species_id, nickname_localized, breed_text_localized, sex, date_of_birth)
  VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 990001,
          '{"en":"Bess","ru":"Бес"}', '{"en":"mix","ru":"мет"}', 'Female', '2021-01-01');
INSERT INTO listings (id, animal_id, seller_id, listing_type)
  VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000000a1', 'sale');
SQL
psqlt -f "$(mig 0033)" >/dev/null
psqlt -f "$(mig 0033)" >/dev/null   # 2nd pass = idempotency on populated data
psqlt >/dev/null <<'SQL'
DO $$
DECLARE m text;
BEGIN
  SELECT market INTO m FROM listings WHERE id = '00000000-0000-0000-0000-0000000000c1';
  IF m IS DISTINCT FROM 'livestock' THEN
    RAISE EXCEPTION 'P2-3 FAIL (0033): backfill expected market=livestock, got %', COALESCE(m, 'NULL');
  END IF;
  -- The NOT NULL constraint must actually hold after the backfill.
  BEGIN
    INSERT INTO listings (id, animal_id, seller_id, listing_type, market)
      VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1',
              '00000000-0000-0000-0000-0000000000a1', 'sale', NULL);
    RAISE EXCEPTION 'P2-3 FAIL (0033): NULL market was accepted (SET NOT NULL not enforced)';
  EXCEPTION WHEN not_null_violation THEN NULL; -- expected
  END;
END $$;
SQL
echo "  ✅ 0033 market backfilled to 'livestock' + NOT NULL enforced"

# ── 0032: favorites.offering_id backfilled from listing_id; saved_searches defaults ─────────────────
echo "→ 0032 offering-ref — seed favorite/saved_search, drop columns, replay ×2, assert backfill"
psqlt >/dev/null <<'SQL'
-- Simulate pre-0032: the polymorphic offering pointer did not yet exist on either table.
ALTER TABLE favorites      DROP COLUMN offering_id   CASCADE;
ALTER TABLE favorites      DROP COLUMN offering_type CASCADE;
ALTER TABLE saved_searches DROP COLUMN offering_id   CASCADE;
ALTER TABLE saved_searches DROP COLUMN offering_type CASCADE;
INSERT INTO favorites (id, user_id, listing_id)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000c1');
INSERT INTO saved_searches (id, user_id)
  VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1');
SQL
psqlt -f "$(mig 0032)" >/dev/null
psqlt -f "$(mig 0032)" >/dev/null   # 2nd pass = idempotency on populated data
psqlt >/dev/null <<'SQL'
DO $$
DECLARE oid uuid; otype text; ss_type text; ss_oid uuid;
BEGIN
  SELECT offering_id, offering_type INTO oid, otype FROM favorites WHERE id = '00000000-0000-0000-0000-0000000000d1';
  IF oid IS DISTINCT FROM '00000000-0000-0000-0000-0000000000c1' THEN
    RAISE EXCEPTION 'P2-3 FAIL (0032): favorites.offering_id expected == listing_id, got %', COALESCE(oid::text, 'NULL');
  END IF;
  IF otype IS DISTINCT FROM 'ANIMAL_LISTING' THEN
    RAISE EXCEPTION 'P2-3 FAIL (0032): favorites.offering_type expected ANIMAL_LISTING, got %', COALESCE(otype, 'NULL');
  END IF;
  SELECT offering_type, offering_id INTO ss_type, ss_oid FROM saved_searches WHERE id = '00000000-0000-0000-0000-0000000000e1';
  IF ss_type IS DISTINCT FROM 'ANIMAL_LISTING' THEN
    RAISE EXCEPTION 'P2-3 FAIL (0032): saved_searches.offering_type expected ANIMAL_LISTING default, got %', COALESCE(ss_type, 'NULL');
  END IF;
  IF ss_oid IS NOT NULL THEN
    RAISE EXCEPTION 'P2-3 FAIL (0032): saved_searches.offering_id must stay NULL (a search is not one offering), got %', ss_oid;
  END IF;
END $$;
SQL
echo "  ✅ 0032 favorites.offering_id == listing_id + saved_searches defaults correct"

# ── 0036: consents.seq monotonic backfill on POPULATED rows (physical insertion order) ──────────────
echo "→ 0036 consents.seq — seed 2 rows, drop column, replay ×2, assert monotonic backfill"
psqlt >/dev/null <<'SQL'
-- Simulate pre-0036: the monotonic tie-break column did not yet exist.
ALTER TABLE consents DROP COLUMN seq CASCADE;
-- Two rows, IDENTICAL created_at (the tie the seq exists to break), inserted grant-then-withdraw.
INSERT INTO consents (id, user_id, consent_type, granted, policy_version, source, actor_id, created_at)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1',
          'CONTACT_DISTRIBUTION', true, '1.0', 'TEST', '00000000-0000-0000-0000-0000000000a1', '2026-07-08T12:00:00Z');
INSERT INTO consents (id, user_id, consent_type, granted, policy_version, source, actor_id, created_at)
  VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1',
          'CONTACT_DISTRIBUTION', false, '1.0', 'TEST', '00000000-0000-0000-0000-0000000000a1', '2026-07-08T12:00:00Z');
SQL
psqlt -f "$(mig 0036)" >/dev/null
psqlt -f "$(mig 0036)" >/dev/null   # 2nd pass = idempotency on populated data (no seq re-assignment)
psqlt >/dev/null <<'SQL'
DO $$
DECLARE grant_seq bigint; withdraw_seq bigint;
BEGIN
  SELECT seq INTO grant_seq    FROM consents WHERE id = '00000000-0000-0000-0000-0000000000f1';
  SELECT seq INTO withdraw_seq FROM consents WHERE id = '00000000-0000-0000-0000-0000000000f2';
  IF grant_seq IS NULL OR withdraw_seq IS NULL THEN
    RAISE EXCEPTION 'P2-3 FAIL (0036): seq not backfilled (grant=%, withdraw=%)', grant_seq, withdraw_seq;
  END IF;
  -- The row inserted LAST (the withdrawal) must get the strictly greater seq → currentlyGranted resolves
  -- it as current even though created_at ties. That is the whole point of the monotonic column.
  IF NOT (withdraw_seq > grant_seq) THEN
    RAISE EXCEPTION 'P2-3 FAIL (0036): seq not monotonic by insertion order (grant=%, withdraw=%)', grant_seq, withdraw_seq;
  END IF;
END $$;
SQL
echo "  ✅ 0036 consents.seq backfilled monotonically by insertion order (later row wins)"

echo "✅ all backfill migrations produce correct data on POPULATED tables (AUDIT4 P2-3)"
