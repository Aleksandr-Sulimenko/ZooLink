-- Migration: 20260701_0027_goods_marketplace_toggle
-- Impl-wave A / Q4 (GAP-BA-011) — seed the feature_toggles.goods_marketplace gate (FORM now, behaviour later).
--
-- WHAT
--   Insert one feature_toggles row: key='goods_marketplace', is_enabled=false, rollout_percentage=0.
--   No schema/DDL change — data-only seed of an existing table. Table count unchanged (35).
--
-- WHY
--   The owner explicitly requested (GAP-BA-011) a gate for a future "goods" marketplace (accessories,
--   feed, vet supplies, etc.) that is NOT part of the animals marketplace MVP. Per the phase-by-cost-of-
--   change rule + "form exists, behaviour deferred" pattern (identical to payments /
--   ownership_transfer_verification), the gate FORM is created now so behaviour can be built behind it in
--   Фаза 2+ without a later schema/seed scramble. Nothing reads it yet; it ships OFF.
--
-- WHY BETTER (whole-project)
--   - Consistency: same shape/placement as the existing MVP-off toggles (one INSERT ... ON CONFLICT).
--   - Honest gate: a documented, queryable switch instead of an implicit "someday" note.
--   - Zero blast radius: data-only, default-off, no code path consumes it — MVP behaviour is unchanged.
--
-- Idempotent: INSERT ... ON CONFLICT (key) DO NOTHING. Safe to run twice (proves idempotency).

BEGIN;

INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('goods_marketplace',
        'Маркетплейс товаров (аксессуары, корма, ветпрепараты и т.п.) — форма гейта заведена, поведение отложено до Фазы 2+ (GAP-BA-011). Выключено в MVP.',
        FALSE, 0)
ON CONFLICT (key) DO NOTHING;

COMMIT;
