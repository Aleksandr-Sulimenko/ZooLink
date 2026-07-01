-- Migration: 20260701_0028_pii_email_blind_index_encrypt
-- ADR-0019 (Accepted, enforces ADR-0012) — PII-at-rest crypto seam, T1 BLOCKER columns.
--
-- WHAT
--   Schema/DDL for the go-live-blocking form (the *code* seam = CryptoService; the *data* backfill =
--   the companion TS script prisma/backfill/0028_pii_backfill.ts, which must run once after this DDL):
--     1. users.email_bidx VARCHAR(60) — deterministic HMAC-SHA256 blind index over the normalised
--        (trim+lowercase) email, so /auth/recover/email/* and the admin user-search look up by index,
--        never by plaintext (phone_hash precedent, ADR-0011).
--     2. Widen users.email and users.contact_phone to TEXT — AES-256-GCM ciphertext (iv|tag|ct, base64url,
--        'enc:v1:' prefixed) is longer than the plaintext and no longer fits VARCHAR(255)/VARCHAR(30).
--     3. Replace the plaintext lookup index idx_users_email with idx_users_email_bidx (email is now
--        ciphertext — an index on it is useless; equality lookup moves to the blind index).
--   No table added/removed (35 unchanged).
--
-- WHY
--   ADR-0019 §Decision(1): email must stay reversible & searchable (recovery sends an OTP *to* the
--   address AND looks it up) → ciphertext (sendable) + deterministic blind index (searchable). The
--   blind index is the irreversible-if-deferred piece: retrofitting it once accounts exist means an
--   HMAC backfill over every email + a recovery read-path rewrite — the exact retrofit ADR-0012 was
--   written to avoid. contact_phone (OD-1) is field-encrypted before launch; it has no active read/
--   write path yet (contact-exchange = sub-wave C, deferred) so only the column widening + backfill
--   ship now — the seam is ready the moment that feature lands.
--
-- WHY BETTER (whole-project)
--   - Anti-rewrite: correct from account #1 (§WHY of ADR-0019); no future recovery-path rewrite.
--   - Reuses the phone_hash HMAC blind-index pattern (ADR-0011) — one idiom for searchable PII.
--   - The 'enc:v1:' prefix versions the primitive: a future certified-СКЗИ/ГОСТ swap (ADR-0019 residual)
--     is a CryptoService change behind the seam, not a schema/contract rewrite.
--   - T2 columns (full_name, org {inn,kpp,address,phone}) stay plaintext, staged behind the same seam —
--     no change here; org/branch email are NOT looked up in code (verified) so they need no blind index.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS · ALTER COLUMN ... TYPE TEXT (no-op when already TEXT) ·
--   DROP INDEX IF EXISTS · CREATE INDEX IF NOT EXISTS. Safe to run twice (proves idempotency).
--   Backfill (encrypt existing plaintext + populate email_bidx) is idempotent in the TS companion.
--
-- Validated on live PostgreSQL 14/16 (run twice — idempotent).

BEGIN;

-- 1. Deterministic blind index for the email equality-lookup path (43-char base64url HMAC-SHA256,
--    same shape/width convention as phone_hash VARCHAR(60)).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bidx VARCHAR(60);
COMMENT ON COLUMN users.email_bidx IS
  'Deterministic HMAC-SHA256 blind index over the normalised (trim+lowercase) email (ADR-0019/ADR-0011). '
  'Searchable equality index for account recovery + admin user-search; the email column itself is AES-256-GCM ciphertext.';

-- 2. Widen the two field-encrypted PII columns to hold ciphertext ('enc:v1:'+base64url(iv|tag|ct)).
ALTER TABLE users ALTER COLUMN email TYPE TEXT;
ALTER TABLE users ALTER COLUMN contact_phone TYPE TEXT;
COMMENT ON COLUMN users.email IS
  'AES-256-GCM ciphertext (enc:v1: prefix) of the account email — reversible (sendable for recovery). '
  'Lookup is via email_bidx, never this column. Legacy plaintext tolerated on read during rollout (ADR-0019).';
COMMENT ON COLUMN users.contact_phone IS
  'AES-256-GCM ciphertext (enc:v1: prefix) of the marketplace contact phone (ADR-0019 OD-1, field-encrypted before launch). '
  'No active read/write path yet — contact-exchange is deferred (sub-wave C); the seam is ready.';

-- 3. Swap the now-useless plaintext email index for the blind-index equality index.
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX IF NOT EXISTS idx_users_email_bidx ON users(email_bidx) WHERE email_bidx IS NOT NULL;

COMMIT;
