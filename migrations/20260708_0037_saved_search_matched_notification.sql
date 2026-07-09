-- Migration: 20260708_0037_saved_search_matched_notification
-- Slice H4 (AUDIT4 — first strategic demand-side return feature). Builds on ADR-0021 (outbox consumer,
-- Wave C4) + Wave H3. Sub-wave: saved-search → notify.
--
-- WHAT
--   Seed the EMAIL notification template `saved_search_matched` (ru + en). When a listing goes ACTIVE
--   (Moderation APPROVE → `Listing.Activated`, already emitted in-tx), a NEW worker-side consumer
--   matches it against users' saved searches and materializes one durable IN_APP `notification_logs`
--   row per matching (saved_search, listing) pair, rendered from THIS EMAIL source template
--   (channel ≠ source — the same discipline as the transfer/moderation templates, ADR-0021).
--   No table added or removed (37 tables unchanged). NO new column: matching consumes the existing
--   `Listing.Activated` event and dedups per-pair via a deterministic notification idempotency_key
--   (`saved_search_matched:<savedSearchId>:<listingId>`), so no per-listing "notified" marker column
--   is needed.
--
-- WHY
--   AUDIT4 flagged that the platform had no demand-side return loop: a user saves a search and is never
--   told when a matching listing appears — the single highest-leverage retention signal for a two-sided
--   marketplace (they asked to be told). The saved-search table, the OfferingRef seam (0032), and the
--   notification consumer infra (0030, ADR-0021) already exist; only the template row and the matcher
--   consumer were missing. Spec 07 (round-5) had pre-scoped "proactive alerts" to Phase 2; the audit
--   pulls it forward (phase-by-cost-of-change — the infra is here now, and it is a stated business need).
--
-- WHY-BETTER-for-the-whole-project
--   - Seeding as EMAIL (not IN_APP) reuses the exact same rows the day a real email/SMS provider ships
--     (ADR-0008 form-now); the IN_APP row is the CHANNEL, the EMAIL template is the SOURCE.
--   - Data-only, ON CONFLICT (name,type,language) DO NOTHING → idempotent (run-twice proven), and it
--     touches no schema, so it is trivially N-1-safe (an old pod is unaffected by a new template row).
--   - A saved-search alert is a USER-REQUESTED service notification (opt-in by the act of saving), so it
--     is delivered transactional-always over IN_APP (not gated by notification_prefs.promo, which
--     governs future EMAIL/SMS marketing pushes) — consistent with the existing consumer discipline.
--
-- Idempotent: template seed is ON CONFLICT (name, type, language) DO NOTHING. Safe to run twice.
-- Negative-test focus (in the e2e): cross-market saved searches NEVER match (ADR-0002); a user is
-- notified at most once per (saved_search, listing); the seller is never notified about their own listing.

-- Saved-search match template (EMAIL source rows; the IN_APP notification renders from these).
INSERT INTO notification_templates (name, type, subject_template, body_template, language, is_active) VALUES
 ('saved_search_matched', 'EMAIL', 'Новое объявление по вашему сохранённому поиску',
    'По вашему сохранённому поиску появилось новое объявление: {{listing_title}}. Откройте его в приложении (id {{listing_id}}).', 'ru', TRUE),
 ('saved_search_matched', 'EMAIL', 'A new listing matches your saved search',
    'A new listing matches your saved search: {{listing_title}}. Open it in the app (id {{listing_id}}).', 'en', TRUE)
ON CONFLICT (name, type, language) DO NOTHING;
