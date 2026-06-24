-- Migration 0015 — Identity Slice 4: users.erased_at marker for ФЗ-152 right-to-erasure.
--
-- ЧТО: добавляет колонку users.erased_at (TIMESTAMPTZ, nullable).
-- ПОЧЕМУ: процедура erase_user (data-governance.md §2) анонимизирует аккаунт «на месте»
--   (PII → NULL/tombstone, идентификаторы освобождаются), сохраняя UUID для FK RESTRICT.
--   Нужен явный маркер, чтобы (а) отличать стёртый аккаунт от просто DEACTIVATED и
--   (б) сделать erase идемпотентным (повторный вызов = no-op).
-- ПОЧЕМУ ТАК ЛУЧШЕ: единственный источник истины жизненного цикла — status; erased_at это
--   производная метка-факт (как deactivated_at), не новое состояние стейт-машины — поэтому
--   CHECK на status не трогаем (стёртый аккаунт остаётся DEACTIVATED). Идемпотентно (IF NOT EXISTS).
--
-- Validated on live PostgreSQL 14/16 (run twice — idempotent).

ALTER TABLE users ADD COLUMN IF NOT EXISTS erased_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN users.erased_at IS
  'Set by erase_user() (ФЗ-152 anonymise-in-place); marks PII removed, identifiers released, UUID retained. NULL = not erased.';
