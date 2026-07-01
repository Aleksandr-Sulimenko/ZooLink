# ADR-0019: PII-at-rest — enforce the ADR-0012 form now (blind-index + crypto seam), stage field-encryption rollout

**Status**: Proposed — awaiting security+legal at-rest launch-floor sign-off (owner reviewed Q1–Q6 2026-07-01)
**Date**: 2026-07-01
**Amends**: [ADR-0012](0012-pii-at-rest-encryption.md) — **enforces and time-orders ADR-0012's already-decided "form now / rollout staged" split; does NOT supersede or change its decision.** ADR-0012 stays Accepted.
**Relates to**: [ADR-0017](0017-rf-data-residency.md) (residency complements at-rest protection), [ADR-0011](0011-agent-principal-actor-model.md) (`phone_hash` HMAC precedent), Legal launch-compliance **A-items** (`docs/legal/launch-compliance-checklist.md`).
**Needs sign-off**: security + legal (is a storage-level baseline an acceptable ФЗ-152 at-rest floor at launch?) — **owner ratifies**.

> **WHAT** — ADR-0012 already decided the *form* (column shape, `CryptoService` seam, deterministic **blind-index** for the email lookup path, key-env/KMS swap-point) is built **now** and the heavy *per-column field-encryption rollout* is staged behind it. The audit found the **form was never built** (no `CryptoService`, no blind-index; `email`/`full_name`/`contact_*` plaintext; recovery searches plaintext email). This ADR resolves the gap: **(1)** mandate the blind-index + crypto seam form as **go-live-blocking** (it is the cheap, irreversible piece tied to email recovery); **(2)** add a **storage-level/volume encryption baseline** as the ФЗ-152 at-rest floor at launch (devops); **(3)** formally stage the bulk per-column field-encryption rollout behind the seam, tracked in the backlog.
>
> **WHY** — The blind-index is the irreversible piece: once accounts exist with plaintext-only email and `/auth/recover/email/*` queries plaintext, adding a deterministic blind index later means **backfilling an HMAC over every email AND rewriting the recovery read-path** — exactly the retrofit ADR-0012 was written to avoid, and it grows with every account. Conversely, the full per-column field-encryption *rollout* is genuinely stageable (read/write adapters can encrypt column-by-column behind the seam). So the right resolution is **not** to re-decide ADR-0012 but to **enforce its form and order it correctly** against go-live.
>
> **WHY-BETTER for the whole project** — Honours the §5 phasing rule ADR-0012 itself invoked (form-now if deferral forces a rewrite; behaviour staged) instead of silently letting "form now" slip to "never." It gives legal a defensible ФЗ-152 at-rest answer at launch (storage-level baseline + blind-index protecting the lookup column) without blocking launch on a full field-encryption rollout, and it keeps the email-recovery path correct from the first account. It composes with ADR-0017 (residency = where; encryption = how-protected) and reuses the `phone_hash` HMAC precedent (ADR-0011).

## Context and Problem Statement

ADR-0012 (Accepted) decided PII-at-rest with a clear §5 split: **form now** = column shape + `CryptoService` abstraction + **deterministic blind-index** for the `email` lookup (because recovery must search by email and randomized ciphertext isn't searchable) + key-env with an RF-KMS swap-point; **rollout staged** = per-column field-encryption behind that seam. The audit found **none of the form shipped**: no `CryptoService`/blind-index, `email`/`full_name`/`contact_*`/org fields plaintext, and account recovery queries plaintext `email`. Meanwhile ФЗ-152 + `security_specification.md` require PII protected at rest, and ADR-0017 now pins residency.

Two distinct pieces with different reversibility:
- **Blind-index + crypto seam (form)** — *irreversible-if-deferred*. Plaintext-only email + plaintext recovery-lookup cannot be cleanly retrofitted to a blind index without backfilling HMACs over all rows and rewriting the recovery path; cost grows per account.
- **Per-column field-encryption (rollout)** — *stageable*. Column-by-column behind the seam; storage-level encryption can hold the at-rest floor in the interim.

The deliverable choice: **amend-with-formal-deferral (track in backlog)** vs **mandate the blind-index form now**.

## Decision Drivers

1. **Irreversibility of the lookup path** — blind-index over `email` is the piece that's painful to retrofit once accounts exist (strongest driver; mirrors ADR-0012's own anti-rewrite rationale).
2. **ФЗ-152 at-rest requirement at launch** (legal A-items) — *some* at-rest protection must exist on go-live, not "later."
3. **Don't re-decide a sound ADR** — ADR-0012's form/rollout split is right; the failure is non-implementation, so enforce + order, don't supersede.
4. **Email must stay reversible & searchable** — recovery sends an OTP *to* the address (not a one-way hash) AND looks it up → needs ciphertext + a deterministic blind index. (ADR-0012 already reasoned this.)
5. **Reuse `phone_hash` precedent** (ADR-0011) — deterministic HMAC blind-index pattern already in the codebase.
6. **MVP scope (ADR-0009)** — no heavy KMS infra now; storage-level baseline + seam with a KMS swap-point.

## Considered Options

### Option A: Amend ADR-0012 with a formal deferral — accept plaintext PII at rest at launch as a documented, time-boxed risk
Downgrade "form now" to "tracked backlog"; ship with plaintext PII + plaintext recovery; encrypt later.

Pros:
- Fastest path to launch; zero crypto work now.

Cons:
- **Retrofitting the blind-index later is the exact rewrite ADR-0012 forbade**, and the backfill grows per account.
- Plaintext PII at rest is hard to defend under ФЗ-152 / `security_spec` at launch (legal exposure; a DB dump exposes everything).
- Re-decides a sound ADR in the wrong direction to match a non-implementation.

### Option B: Mandate the blind-index + crypto seam form now; storage-level baseline at launch; stage field-encryption rollout (Chosen)
Build the irreversible form before launch (blind-index over `email`, `CryptoService` seam, key-env/KMS swap-point); enable storage-level/volume encryption for the ФЗ-152 at-rest floor; stage per-column field-encryption behind the seam, backlog-tracked.

Pros:
- The irreversible piece is correct from account #1 — no future backfill/rewrite of the recovery path.
- Storage-level baseline gives a defensible ФЗ-152 at-rest answer at launch without blocking on a full rollout.
- Honours ADR-0012's own §5 split; reuses `phone_hash` HMAC precedent.
- Field-encryption rollout proceeds column-by-column behind the seam at a safe pace.

Cons:
- Some crypto-seam work before launch (bounded: seam + one blind-index column + storage encryption).
- Storage-level baseline alone may not satisfy `security_spec`'s "field-level for highly sensitive PII" — needs security+legal sign-off on whether it's an acceptable *launch floor* with field-rollout to follow.

## Decision

Adopt **Option B**. ADR-0012 stands; this ADR enforces and orders it:

1. **Go-live-blocking form (build before launch):**
   - **`CryptoService` seam** (encrypt/decrypt abstraction) with a **key-env + RF-KMS swap-point** (no key in SQL text — ADR-0012 Option-2 rejected).
   - **Deterministic blind-index over `email`** (HMAC, `phone_hash` precedent) so `/auth/recover/email/*` looks up by index, never by plaintext.
   - `email` stored as **reversible ciphertext** (sendable) + its blind index; the recovery read-path uses the index.
2. **ФЗ-152 at-rest baseline at launch:** enable **storage-level / encrypted-volume** encryption for the PII-bearing stores (devops) — the at-rest floor, composing with ADR-0017 residency.
3. **Staged rollout (backlog-tracked, behind the seam):** per-column field-encryption for the remaining PII (`full_name`, `contact_*`, `avatar_url`, `organizations.{inn,kpp,email,phone,address}`, notification recipient/content) rolls out column-by-column behind `CryptoService` — no schema/contract rewrite, since the seam exists.
4. **No supersession.** ADR-0012's decision is unchanged; this ADR fixes the implementation gap and time-orders form-vs-rollout against go-live.
5. **Residual sign-off (owner ratifies):** **security + legal** confirm whether the storage-level baseline + blind-index is an acceptable ФЗ-152 / `security_spec` at-rest floor for launch with field-rollout to follow, or whether specific "highly sensitive" columns (e.g. `contact_phone`) must be field-encrypted *before* launch too. Flagged, not assumed.

## Consequences

### Positive
- The irreversible blind-index/seam is correct from the first account; no future recovery-path rewrite or HMAC backfill.
- Defensible ФЗ-152 at-rest posture at launch (storage baseline + lookup-column protection).
- Field-encryption rollout proceeds safely behind a stable seam.
- ADR-0012's intent is realised, not silently dropped.

### Negative
- Bounded crypto-seam + blind-index + storage-encryption work before launch.
- Storage-baseline-as-launch-floor needs explicit security+legal sign-off (residual decision, surfaced).

### Neutral
- Reuses the `phone_hash` HMAC pattern; no new crypto primitive.
- Composes with ADR-0017 (residency) — both required, neither substitutes.

## Implementation Notes (backend + devops + security/legal)
- **backend**: `CryptoService` seam + key-env (KMS swap-point); `email` → ciphertext + HMAC blind-index; repoint `/auth/recover/email/*` to the index. Then stage per-column field-encryption behind the seam.
- **devops**: enable encrypted-volume/storage-level encryption on PII-bearing stores (with ADR-0017 RF residency).
- **security + legal**: sign off the launch at-rest floor (storage baseline + blind-index) vs requiring specific field-encryption pre-launch; **owner** ratifies.
- **doc-keeper**: reconcile `nfr/security.md` at-rest claims with the actual staged state (the audit flagged stale "published"/Phase-2 claims).

## Related Decisions
- **ADR-0012** — PII-at-rest (this ADR enforces & orders its form; no supersession).
- **ADR-0017** — RF data residency (where vs how-protected; both required).
- **ADR-0011** — `phone_hash` HMAC blind-index precedent.

## References
- ADR-0012 §form-vs-rollout split; `data-governance.md §1` PII inventory.
- `security/security_specification.md` (field-level encryption for highly sensitive PII).
- `backend/src/modules/auth/*` recovery path (currently plaintext email lookup).
- `AUDIT_2026-06-30.md` Part A MAJOR (ADR-0012 form not implemented).
