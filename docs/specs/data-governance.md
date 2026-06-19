---
version: "1.0"
lastUpdated: "2026-06-18"
author: "Architecture Review Board"
status: "Approved"
---

# Spec: Data Governance — PII, retention, erasure, audit (ФЗ-152)

## Outcome
Make data governance implementable. Provides the **PII inventory**, the **erasure/anonymisation procedure**
(reconciled with append-only audit and FK RESTRICT), **retention/pruning**, the **audit-log** contract, and
**reference-data / feature-toggle governance**. Closes the round-4 governance gaps.

## 1. PII inventory (ФЗ-152) — normative
| Table.column | Category | On erasure |
|---|---|---|
| `users.phone_hash` | identifier (keyed HMAC) | NULL |
| `users.contact_phone`, `users.contact_telegram` | contact PII | NULL |
| `users.contact_prefs` | contact-visibility setting | reset to column default |
| `users.email` | contact PII | NULL |
| `users.full_name` | personal | → `'[deleted]'` tombstone |
| `users.avatar_url` | personal media | delete object from S3, NULL |
| `users.last_login_at`, `users.oauth_*` | behavioural/identifier | NULL |
| `organizations.inn/kpp/email/phone/address` | business PII | NULL on org erasure (keep legal minimum if required) |
| `notification_logs.recipient`, `notification_logs.content` | contact PII | NULL / drop body (store template_id+params only) |
| `contact_reveals.*` | reveal audit (viewer/seller) | retain ids; subject to retention window |
| `listings.lat/lng` | location (approx) | retained (coarse); precise point not stored |
| `audit_log.actor_id` | operator identifier | retained (legal/non-repudiation) |

Logs must **mask** all of the above (no raw phone/email/token/full_name in logs) — see `nfr/observability.md`.

## 2. Erasure / anonymisation procedure
Right-to-erasure (ФЗ-152) is reconciled with traceability as **anonymise-in-place, keep the UUID**:
1. User requests deletion → account `status = DEACTIVATED`, **30-day grace** (recoverable).
2. After grace, run `erase_user(user_id)`:
   - anonymise `users` PII per the table above (UUID retained so FK RESTRICT rows stay valid).
   - NULL `notification_logs.recipient/content` for that user; delete S3 avatar.
   - **Retained under legal hold (NOT erased):** `audit_log`, `moderation_decisions` (append-only),
     `animal_ownership_history`, `payment_transactions`/`refunds` (financial-record law).
   - emit `audit_log` row `action='user.erased'`.
3. Backups: erasure applies to live data immediately; PII in backups expires by backup retention; a restore must
   re-apply the erasure journal (`audit_log action='user.erased'`).

> This supersedes the contradiction between `user_state_machine.md` ("anonymize") and the identity spec
> ("deletion deferred"): **deactivate is MVP; anonymise-erase is the defined procedure, runnable in MVP via `erase_user`**.

## 3. Audit log
Append-only `audit_log` table (`database_schema.sql`, trigger `trg_audit_log_append_only`). Every privileged or
sensitive action writes a row: role changes, suspensions/bans, feature-toggle flips, reference-data changes,
data exports, user erasure, moderation actions (in addition to `moderation_decisions`). Fields: actor_id+role,
action, entity, before/after JSONB, ip, user_agent, created_at. Exposed via admin `GET /audit/log` (ADMIN only).

## 4. Retention / pruning
| Data | Retention |
|---|---|
| `notification_logs` | 90 days, then prune (or mask recipient/content earlier) |
| `contact_reveals` | 12 months (abuse-investigation window), then prune |
| `outbox_events` (processed) | prune `processed_at < now()-7d` (cron in worker) |
| `audit_log` | 3 years (legal/security) |
| DB logical backups | 30 daily / 12 weekly / 12 monthly (storage.md) |

## 5. Reference-data governance (Admin)
- `species`, `breeds`, `cities` carry `is_active` (soft-deactivate; deactivated values stay valid for existing
  references but are hidden from new selections — no cascade delete). Changes are audit-logged.
- **Seeding (MVP):** idempotent seed migration from RF sources — species/breeds (FCI/АКК), cities (РФ FIAS subset).
  Demo rows in `database_schema.sql` are placeholders; production seed is a dedicated migration.
- A renamed/deactivated breed/city never breaks existing animals/users (FK preserved; display falls back to stored ref).

## 6. Feature-toggle governance
- Single source of truth = `feature_toggles`; toggles are flipped only by ADMIN via `PATCH /system/settings/{key}`,
  which records `updated_by` and an `audit_log` row.
- **`rollout_percentage` is deterministic:** a user is in the rollout iff
  `(hashtext(key || user_id::text) & 2147483647) % 100 < rollout_percentage` (stable per user, no per-request flicker).
- Canonical MVP toggles: `payments` (off), `digital_assets` (off), plus product toggles as added. The legacy
  `CHAT_ENABLED/VIDEO_ENABLED/...` list in older drafts is superseded by the seeded set.

## Related
- `database_schema.sql` (audit_log, refresh_tokens, *_is_active, feature_toggles.updated_by), `nfr/security.md`,
  `nfr/observability.md`, `06-admin-domain.md`, `storage.md`, [ADR-0006](../04-decisions/0006-ai-agents-operate-platform.md)
- 🌐 RU mirror: [docsRU/specs/data-governance.md](../../docsRU/specs/data-governance.md)
