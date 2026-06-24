-- Migration 0013 — Reconcile updated_at triggers to the tables that actually have the column
--
-- WHAT: drop every update_*_updated_at trigger, then recreate it only on tables that have an
--       updated_at column.
-- WHY:  the hand-maintained trigger list attached update_*_updated_at to append/log tables with
--       no updated_at column — animal_ownership_history (a LIVE MVP table; closing an ownership
--       row via UPDATE would raise `record "new" has no field "updated_at"`) and messages — the
--       same defect 0012 fixed for outbox_events but missed elsewhere. It also MISSED
--       digital_assets, which has updated_at but never got a trigger.
-- WHY BETTER: deriving the set from information_schema removes the whole bug class (no more
--       drift between the literal list and reality), self-heals existing databases, and is
--       fully idempotent. Mirrors the now-dynamic DO-block in database_schema.sql.

DO $$
DECLARE
    r record;
BEGIN
    -- Remove all existing updated_at triggers (some may be wrong / on the wrong tables).
    FOR r IN
        SELECT t.tgname AS name, t.tgrelid::regclass AS tbl
        FROM pg_trigger t
        WHERE t.tgname LIKE 'update_%_updated_at' AND NOT t.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', r.name, r.tbl);
    END LOOP;

    -- Recreate only where an updated_at column exists.
    FOR r IN
        SELECT c.table_name AS t
        FROM information_schema.columns c
        JOIN pg_tables p ON p.tablename = c.table_name AND p.schemaname = 'public'
        WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
            r.t, r.t);
    END LOOP;
END $$;
