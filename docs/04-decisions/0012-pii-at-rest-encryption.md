# ADR-0012: PII-at-rest encryption (ФЗ-152)

**Status**: Accepted
**Date**: 2026-06-24

> Phasing note (IMPLEMENTATION_PLAYBOOK §5): this ADR fixes the **irreversible form** now (column shape,
> crypto abstraction, key env, blind-index for lookup columns); the heavy **behaviour** (per-column
> field-encryption rollout + RF-KMS wiring) is staged behind that form so no later rewrite is forced.
> **ЧТО / ПОЧЕМУ / ПОЧЕМУ ТАК ЛУЧШЕ** triples are given per decision below.

## Context and Problem Statement

ФЗ-152 and `security/security_specification.md` require **PII encryption at rest** ("Data at Rest:
TDE/filesystem", "Sensitive Data Encryption: … email addresses", "field-level encryption for highly
sensitive PII", "database encryption with separate key management"). Today the PII inventory
(`data-governance.md §1`) is stored **in plaintext** in PostgreSQL: `users.full_name`, `users.email`,
`users.contact_phone`, `users.contact_telegram`, `users.avatar_url`; `organizations.{inn,kpp,email,phone,
address}`; `notification_logs.{recipient,content}`. The only already-protected identifier is
`users.phone_hash` (deterministic **HMAC-SHA256**, ADR-0011/spec 01 — non-reversible lookup index, not
plaintext). Retrofitting encryption after launch means migrating column types, backfilling ciphertext, and
rewriting every read/write path — the exact "cheapest to change during development" trigger.

Two cross-cutting constraints make this non-trivial:
- **Sendability:** `email` must stay reversible (recovery sends an OTP **to** the address) — it cannot be a
  one-way hash like `phone_hash`.
- **Lookup:** `email` is queried during account recovery (`/auth/recover/email/*`) — randomized
  ciphertext is not searchable, so a **deterministic blind-index** is needed for the lookup path.

## Decision Drivers

- **ФЗ-152 / security_spec compliance:** PII protected at rest, with key management separate from data.
- **Anti-rewrite (§5):** column shape + crypto seam + key abstraction are irreversible → decide now.
- **MVP scope (ADR-0009):** no heavy infra in MVP; key management must have an RF-KMS **swap-point**
  (ADR-0008 pattern) without touching domain code.
- **ADR-0007 (SQL canon + Prisma introspect):** the chosen mechanism must survive `prisma db pull`
  (introspection) and the SQL-first workflow.
- **Coexistence with erasure (ADR-0011 / data-governance):** must not fight `erase_user` tombstoning or the
  `phone_hash` HMAC model.

## Considered Options

### Option 1: Storage-level only (TDE / encrypted volume)
Encrypt the DB volume / filesystem; no app changes.

Pros:
- Zero code; covers all columns + backups coarsely; cheap immediate baseline.

Cons:
- Protects only against stolen disks — a compromised DB connection / SQL dump still exposes plaintext PII.
- security_spec explicitly also requires **field-level** encryption for highly sensitive PII → insufficient alone.

### Option 2: `pgcrypto` column-level encryption (in-DB)
`pgp_sym_encrypt`/`decrypt` in SQL with a key passed per query.

Pros:
- In-DB, minimal app code; standard PG extension.

Cons:
- Key travels in SQL text → high risk of leaking into query logs / `pg_stat_statements`.
- Key management lives in the DB layer (against "separate key management").
- Breaks Prisma typing (bytea), search, and the SQL-canon readability; awkward RF-KMS swap.

### Option 3: Application-level envelope encryption + deterministic blind-index (CHOSEN)
A `CryptoService` port in the app encrypts/decrypts PII (AES-256-GCM, per-record random IV) using a **data
key** that is wrapped by a **master key**; the master key comes from a local env secret now and from
**RF-KMS** (Yandex/VK Cloud KMS) in production via an ADR-0008-style adapter. Columns needing lookup
(`email`) additionally carry a deterministic **blind-index** (HMAC-SHA256, same pepper pattern as
`phone_hash`).

Pros:
- Key never enters SQL or logs; separate key management; clean RF-KMS swap-point (behaviour staged).
- Per-column control; randomized ciphertext for display PII, blind-index only where lookup is required.
- Survives Prisma introspect (ciphertext stored as `text`/`bytea`, app-mapped); coexists with `erase_user`
  (tombstone/NULL overrides ciphertext) and `phone_hash` (unchanged).

Cons:
- More moving parts (key wrapping, rotation) — mitigated by staging behaviour behind the form.
- Decryption happens in-app → must keep PII out of logs (already mandated by `nfr/observability.md`).

### Option 4: RF-KMS envelope now (full)
Wire Yandex/VK KMS immediately for all PII.

Pros: strongest key management from day one.
Cons: heavy infra in MVP (ADR-0009 violation); not needed before real-user data → defer the **behaviour**, keep the **seam**.

## Decision

Adopt a **two-tier model**:

- **Tier 1 — storage-at-rest (ops, MVP baseline):** encrypted DB volume / filesystem (TDE-equivalent) +
  SSE on object storage (Yandex Object Storage SSE, already ADR-0008) + encrypted backups. Devops control,
  no schema change; satisfies the coarse "data at rest" requirement immediately.

- **Tier 2 — application-level field encryption (Option 3), FORM now / rollout staged:** a `CryptoService`
  port (AES-256-GCM envelope) with a **LocalMasterKey adapter** (env `PII_ENCRYPTION_KEY` ≥ 32 bytes,
  fail-fast in prod) now and an **RF-KMS adapter** (Yandex/VK KMS) as the deferred production swap-point
  (extends the ADR-0008 provider matrix with a **KMS** row). Field-encrypt the high-sensitivity reversible
  PII; add a deterministic **blind-index** only for lookup columns.

**Column treatment (normative):**

| Column(s) | Treatment | Lookup? |
|---|---|---|
| `users.full_name`, `users.contact_phone`, `users.contact_telegram`, `users.avatar_url` | field-encrypt (randomized) | no |
| `users.email` | field-encrypt (reversible, sendable) **+ `email_blind_index` (HMAC)** | yes (recovery) |
| `users.phone_hash` | **unchanged** (already HMAC, non-reversible) | yes |
| `organizations.{inn,kpp,email,phone,address}` | field-encrypt (randomized) | no (MVP) |
| `notification_logs.{recipient,content}` | drop/mask per data-governance, else field-encrypt | no |

**Erasure interaction:** `erase_user` tombstones/NULLs these columns as today — the tombstone overrides any
ciphertext; nothing to decrypt post-erasure. `phone_hash` release is unchanged.

**ЧТО:** app-level envelope field-encryption + blind-index, behind a port with a local→KMS swap-point;
storage-tier as the coarse baseline. **ПОЧЕМУ:** keeps keys out of SQL/logs and separate from data
(security_spec), gives per-column control, and the column/abstraction form is the irreversible artifact.
**ПОЧЕМУ ТАК ЛУЧШЕ:** ФЗ-152-compliant without dragging KMS infra into MVP (ADR-0009); the RF-KMS swap is a
deferred adapter, not a rewrite; coexists cleanly with `erase_user` and `phone_hash`.

## Consequences

### Positive
- PII at rest is protected by two independent layers; keys are managed separately and rotatable.
- The irreversible form (columns + `CryptoService` + key env + email blind-index) is fixed now → no later schema/path rewrite.
- RF-KMS is a drop-in adapter when production warrants it (ADR-0008 pattern), behaviour-gated until then.

### Negative
- Field-encrypted columns are not directly queryable (except via blind-index) — acceptable; only `email` needs lookup in MVP.
- App must decrypt on read → strict log-masking discipline required (already mandated).

### Neutral
- Tier-1 storage encryption is a deployment concern (devops), tracked separately from this schema-form ADR.
- Full field-encryption rollout + KMS wiring is staged; MVP may ship with the form in place and Tier-1 active.

## Implementation Notes

**Migration spec (for backend — FORM now; population/rollout staged):**
- Add `users.email_blind_index VARCHAR(64)` (deterministic HMAC-SHA256(lower(email), pepper)); unique
  partial index `WHERE email_blind_index IS NOT NULL`; recovery lookup uses it (mirrors `phone_hash`).
- Field-encrypted columns keep their current type for MVP (Tier-1 covers them); when Tier-2 rollout lands,
  store ciphertext in the same column (base64/`text`) or a paired `*_enc` column — the **read/write path
  goes through `CryptoService`**, so the column-name form is the only schema commitment now.
- `CryptoService` port in `backend/src/lib/crypto/` with `LocalMasterKeyAdapter` (env) + a `KmsMasterKeyAdapter`
  stub (deferred); AES-256-GCM, per-record IV, versioned key id for rotation.
- env: `PII_ENCRYPTION_KEY` (≥32, optional in dev/test, **required in prod** via `validateEnv()` — same
  pattern as `AGENT_SERVICE_SIGNING_SECRET`, ADR-0011); `.env.example` placeholder; future `KMS_*` swap.
- DB-workflow: `database_schema.sql` + idempotent migration + ERD + `data-model.md` + counters; live-PG ×2 +
  negative tests (blind-index uniqueness; erase overrides ciphertext); EN↔RU.
- Extend ADR-0008 provider matrix with a **KMS** capability row (Yandex KMS / VK Cloud KMS; dev = local key).

**Out of scope (deferred behaviour):** mass backfill/encryption of existing rows, KMS adapter implementation,
per-column rotation jobs — all behind the form above.

## Related Decisions
- [ADR-0011](0011-agent-principal-actor-model.md): env-secret + fail-fast-in-prod pattern reused for `PII_ENCRYPTION_KEY`; erase/override model.
- [ADR-0008](0008-rf-provider-matrix.md): RF provider abstraction; this ADR adds the KMS swap-point row.
- [ADR-0009](0009-mvp-vs-target-architecture.md): MVP infra boundary — KMS behaviour deferred, form kept.
- [ADR-0007](0007-orm-strategy.md): SQL-canon + Prisma introspect — app-level keeps types clean.

## References
- `docs/specs/data-governance.md` §1 (PII inventory), §erase_user
- `docs/specs/security/security_specification.md` (data-at-rest, field-level encryption, key management)
- `docs/specs/01-identity-domain.md` (phone_hash HMAC; email recovery lookup)
- 🌐 RU mirror: `docsRU/04-decisions/0012-pii-at-rest-encryption.md` (to be created by doc-keeper)
