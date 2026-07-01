# ADR-0019: PII-at-rest — enforce the ADR-0012 form now (blind-index + crypto seam), stage field-encryption rollout

**Status**: Accepted — owner ratified **OD-1** (`contact_phone` field-encrypted before launch) and **OD-2** (AES seam now as defense-in-depth) on 2026-07-01; security + legal at-rest launch-floor sign-off received. One residual **legal investigation** (certified СКЗИ under приказ ФСТЭК №21) is tracked separately and does **not** block the seam.
**Date**: 2026-07-01
**Amends**: [ADR-0012](0012-pii-at-rest-encryption.md) — **enforces and time-orders ADR-0012's already-decided "form now / rollout staged" split; does NOT supersede or change its decision.** ADR-0012 stays Accepted.
**Relates to**: [ADR-0017](0017-rf-data-residency.md) (residency is the *primary* ФЗ-152 go-live floor; at-rest encryption complements it), [ADR-0011](0011-agent-principal-actor-model.md) (`phone_hash` HMAC precedent), Legal launch-compliance **A-items** (`docs/legal/launch-compliance-checklist.md`).
**Sign-off**: security + legal ✅ (2026-07-01) — storage-level baseline + `email` blind-index is an acceptable ФЗ-152 at-rest floor; `contact_phone` field-encrypted before launch (OD-1); AES seam now (OD-2). **Owner ratified.**

> **WHAT** — ADR-0012 already decided the *form* (column shape, `CryptoService` seam, deterministic **blind-index** for the email lookup path, key-env/KMS swap-point) is built **now** and the heavy *per-column field-encryption rollout* is staged behind it. The audit found the **form was never built** (no `CryptoService`, no blind-index; `email`/`full_name`/`contact_*` plaintext; recovery searches plaintext email). This ADR resolves the gap and records the 2026-07-01 sign-off: **(1)** mandate the blind-index + crypto seam form as **go-live-blocking** (the cheap, irreversible piece tied to email recovery); **(2)** add a **storage-level/volume encryption baseline** as the at-rest floor at launch (devops); **(3)** ratify a **column tier table (T0–T3)** that pulls `email` **and `contact_phone` (OD-1)** into the go-live-blocking set and stages the rest behind the seam; **(4)** ratify the **AES `CryptoService` primitive now (OD-2)** as defense-in-depth, with the certified-СКЗИ question carried as a separate legal investigation.
>
> **WHY** — The blind-index is the irreversible piece: once accounts exist with plaintext-only email and `/auth/recover/email/*` queries plaintext, adding a deterministic blind index later means **backfilling an HMAC over every email AND rewriting the recovery read-path** — exactly the retrofit ADR-0012 was written to avoid, and it grows with every account. **Crucially, the sign-off clarified the legal framing:** "build the seam before launch" is an **engineering / anti-rewrite argument, NOT a legal mandate.** The *actual* ФЗ-152 go-live floors, in order, are **data localization (ст.18 ч.5 → ADR-0017) > РКН notification (ст.22) > lawful basis / consent (ст.6, ст.9)** — **not** column-level encryption. Column encryption is defense-in-depth and good practice, but ФЗ-152 does not itself mandate it as the launch gate. So the right resolution is **not** to re-decide ADR-0012 but to **enforce its form, order it correctly against go-live, and be honest about which arguments are legal vs engineering.**
>
> **WHY-BETTER for the whole project** — Honours the §5 phasing rule ADR-0012 itself invoked (form-now if deferral forces a rewrite; behaviour staged) instead of silently letting "form now" slip to "never." It gives legal an **accurate** ФЗ-152 picture (residency is the floor; storage-level + blind-index at-rest is a defensible complement) without overstating encryption as a legal launch gate, and it keeps the email-recovery path correct from the first account. It composes with ADR-0017 (residency = where; encryption = how-protected) and reuses the `phone_hash` HMAC precedent (ADR-0011). The tier table makes the "which column, when" decision explicit and auditable.

## Context and Problem Statement

ADR-0012 (Accepted) decided PII-at-rest with a clear §5 split: **form now** = column shape + `CryptoService` abstraction + **deterministic blind-index** for the `email` lookup (because recovery must search by email and randomized ciphertext isn't searchable) + key-env with an RF-KMS swap-point; **rollout staged** = per-column field-encryption behind that seam. The audit found **none of the form shipped**: no `CryptoService`/blind-index, `email`/`full_name`/`contact_*`/org fields plaintext, and account recovery queries plaintext `email`. Meanwhile ADR-0017 now pins residency as the primary ФЗ-152 go-live floor.

Two distinct pieces with different reversibility:
- **Blind-index + crypto seam (form)** — *irreversible-if-deferred*. Plaintext-only email + plaintext recovery-lookup cannot be cleanly retrofitted to a blind index without backfilling HMACs over all rows and rewriting the recovery path; cost grows per account.
- **Per-column field-encryption (rollout)** — *stageable*. Column-by-column behind the seam; storage-level encryption can hold the at-rest floor in the interim.

The deliverable choice: **amend-with-formal-deferral (track in backlog)** vs **mandate the blind-index form now**.

### The legal floor, stated precisely (2026-07-01 sign-off — both roles)
The prior draft risked implying that at-rest encryption is a ФЗ-152 launch mandate. Security **and** legal agree it is not:
- **Storage-level (encrypted-volume) + a blind index over `email` is an acceptable ФЗ-152 at-rest floor at launch.**
- **"Build the seam before launch" is an engineering / anti-rewrite argument, not a legal one** — the driver is retrofit cost, not a statute.
- The **real ФЗ-152 go-live floors, ranked**, are: **(1) data localization — ст.18 ч.5 (ADR-0017) → (2) РКН notification — ст.22 → (3) lawful basis / consent — ст.6, ст.9.** Column-level field-encryption is **not** among them; it is defense-in-depth.

This keeps the legal case honest and puts launch effort where the statute actually points (ADR-0017 first).

## Decision Drivers

1. **Irreversibility of the lookup path** — blind-index over `email` is the piece that's painful to retrofit once accounts exist (strongest *engineering* driver; mirrors ADR-0012's own anti-rewrite rationale).
2. **Honest ФЗ-152 framing** — the launch floor is **residency (ADR-0017) > РКН > basis/consent**, not column encryption; at-rest crypto is defense-in-depth (legal + security).
3. **Don't re-decide a sound ADR** — ADR-0012's form/rollout split is right; the failure is non-implementation, so enforce + order, don't supersede.
4. **Email must stay reversible & searchable** — recovery sends an OTP *to* the address (not a one-way hash) AND looks it up → needs ciphertext + a deterministic blind index. (ADR-0012 already reasoned this.)
5. **`contact_phone` sensitivity (OD-1)** — the primary contact channel between strangers in a marketplace; ratified as field-encrypted **before launch**, not staged.
6. **Reuse `phone_hash` precedent** (ADR-0011) — deterministic HMAC blind-index pattern already in the codebase.
7. **MVP scope (ADR-0009)** — no heavy KMS infra now; storage-level baseline + AES seam (OD-2) with a KMS swap-point.

## Considered Options

### Option A: Amend ADR-0012 with a formal deferral — accept plaintext PII at rest at launch as a documented, time-boxed risk
Downgrade "form now" to "tracked backlog"; ship with plaintext PII + plaintext recovery; encrypt later.

Pros:
- Fastest path to launch; zero crypto work now.

Cons:
- **Retrofitting the blind-index later is the exact rewrite ADR-0012 forbade**, and the backfill grows per account.
- Even if not a strict ФЗ-152 launch mandate, plaintext PII at rest is weak defense-in-depth (a DB dump exposes everything) and hard to defend to РКН post-incident.
- Re-decides a sound ADR in the wrong direction to match a non-implementation.

### Option B: Mandate the blind-index + crypto seam form now; storage-level baseline at launch; stage field-encryption rollout (Chosen)
Build the irreversible form before launch (blind-index over `email`, AES `CryptoService` seam, key-env/KMS swap-point); field-encrypt `contact_phone` before launch (OD-1); enable storage-level/volume encryption for the at-rest floor; stage per-column field-encryption behind the seam, backlog-tracked.

Pros:
- The irreversible piece is correct from account #1 — no future backfill/rewrite of the recovery path.
- Storage-level baseline + blind-index gives a defensible ФЗ-152 at-rest complement at launch without blocking on a full rollout.
- Honours ADR-0012's own §5 split; reuses `phone_hash` HMAC precedent.
- Field-encryption rollout proceeds column-by-column behind the seam at a safe pace.

Cons:
- Some crypto-seam work before launch (bounded: seam + `email` blind-index + `contact_phone` field-encryption + storage encryption).
- The AES primitive may not satisfy a *formal* СКЗИ requirement if приказ ФСТЭК №21 applies — carried as a separate legal investigation (below), not a blocker.

## Decision

Adopt **Option B**. ADR-0012 stands; this ADR enforces and orders it, and records the 2026-07-01 ratification:

1. **Go-live-blocking form (build before launch):**
   - **AES `CryptoService` seam (OD-2)** — encrypt/decrypt abstraction with a **key-env + RF-KMS swap-point** (no key in SQL text — ADR-0012 Option-2 rejected). AES now as **defense-in-depth**; the certified-СКЗИ question is a separate investigation (§Residual), not a blocker.
   - **Deterministic blind-index over `email`** (HMAC, `phone_hash` precedent) so `/auth/recover/email/*` looks up by index, never by plaintext; `email` stored as **reversible ciphertext** (sendable) + its blind index.
   - **`contact_phone` field-encrypted (OD-1)** — ratified before launch (not staged).

2. **PII-at-rest column tier table (ratified):**

   | Tier | Columns | Action at launch |
   |---|---|---|
   | **T0 — already hashed** | `password_hash`, `phone_hash`, `*token_hash`, `service_credentials` (hashed secret), `oauth_*_id` | **none** — already one-way/appropriate. |
   | **T1 — BLOCKER before launch** | **`email`** (ciphertext + HMAC blind-index + recovery repoint) · **`contact_phone`** (field-encrypt — **OD-1**) | build now (go-live-blocking). |
   | **T2 — staged behind the seam** | `full_name`, organization `{inn, kpp, address, phone}`, notification recipient/content | roll out column-by-column behind `CryptoService`, backlog-tracked. |
   | **T3 — not crypto** | `avatar_url` | not a crypto concern — handled by `@IsUrl` validation + anti-XSS output encoding, separately. |

3. **ФЗ-152 at-rest baseline at launch:** enable **storage-level / encrypted-volume** encryption for the PII-bearing stores (devops) — the at-rest floor, **complementing** ADR-0017 residency (which is the *primary* legal floor).

4. **Staged rollout (backlog-tracked, behind the seam):** the T2 columns roll out column-by-column behind `CryptoService` — no schema/contract rewrite, since the seam exists.

5. **No supersession.** ADR-0012's decision is unchanged; this ADR fixes the implementation gap, ratifies the tier table + AES primitive, and time-orders form-vs-rollout against go-live.

## Residual open item — certified-СКЗИ legal investigation (does not block)

**Flagged, not decided here.** The AES `CryptoService` primitive (OD-2) is adopted now as defense-in-depth. **Open legal-investigation:** whether the applicable **уровень защищённости (УЗ)** under **приказ ФСТЭК России №21** requires **certified СКЗИ (ГОСТ / ФСБ-certified cryptography)** for the protection to *formally count* under the regulation. If the investigation concludes yes, the primitive is swapped (GOST cipher via a certified module) behind the same `CryptoService` seam — **which is exactly why the seam exists**, so the swap is not a rewrite. Tracked as a **separate legal ticket**; it does **not** block building or shipping the seam. Owner + legal to close.

## Consequences

### Positive
- The irreversible blind-index/seam is correct from the first account; no future recovery-path rewrite or HMAC backfill.
- Accurate ФЗ-152 posture at launch: residency (ADR-0017) is the floor; storage baseline + blind-index + `contact_phone` field-encryption are a defensible at-rest complement.
- Field-encryption rollout proceeds safely behind a stable seam; a future СКЗИ swap is a primitive change behind the seam, not a rewrite.
- ADR-0012's intent is realised, not silently dropped; the tier table makes "which column, when" explicit.

### Negative
- Bounded crypto-seam + `email` blind-index + `contact_phone` field-encryption + storage-encryption work before launch.
- One residual legal question (certified СКЗИ) is open — surfaced and ticketed, not silently assumed.

### Neutral
- Reuses the `phone_hash` HMAC pattern; AES seam introduces the crypto primitive with a certified-СКЗИ swap-point.
- Composes with ADR-0017 (residency) — both required, neither substitutes; residency ranks above at-rest crypto as the legal floor.

## Sign-off record (2026-07-01)
- **security + legal** — storage-level baseline + `email` blind-index is an acceptable ФЗ-152 at-rest floor; the real go-live legal floors are residency (ADR-0017) > РКН > basis/consent, **not** column encryption ("build the seam" = engineering/anti-rewrite, not legal). ✅
- **owner** — ratified **OD-1** (`contact_phone` field-encrypted before launch) and **OD-2** (AES seam now as defense-in-depth). ✅
- **residual** — certified-СКЗИ (приказ ФСТЭК №21) investigation ticketed to legal; does not block the seam.

## Implementation Notes (backend + devops + security/legal)
- **backend**: AES `CryptoService` seam + key-env (KMS swap-point); `email` → ciphertext + HMAC blind-index; repoint `/auth/recover/email/*` to the index; **`contact_phone` → field-encrypted (OD-1)**. Then stage the T2 columns behind the seam.
- **devops**: enable encrypted-volume/storage-level encryption on PII-bearing stores (with ADR-0017 RF residency).
- **legal**: open the **certified-СКЗИ / приказ ФСТЭК №21** investigation ticket (УЗ determination); close with owner. Does not gate the seam.
- **doc-keeper**: reconcile `nfr/security.md` at-rest claims with the actual staged state and the corrected legal framing (residency-first).

## Related Decisions
- **ADR-0012** — PII-at-rest (this ADR enforces & orders its form; no supersession).
- **ADR-0017** — RF data residency — the **primary** ФЗ-152 go-live floor (where vs how-protected; both required, residency ranks first).
- **ADR-0011** — `phone_hash` HMAC blind-index precedent.

## References
- ADR-0012 §form-vs-rollout split; `data-governance.md §1` PII inventory.
- **ФЗ-152 ст.18 ч.5** (localization), **ст.22** (РКН notification), **ст.6 / ст.9** (lawful basis / consent) — the actual ranked go-live floors.
- **приказ ФСТЭК России №21** (требования к защите ПДн; УЗ; certified-СКЗИ question — residual investigation).
- `security/security_specification.md` (field-level encryption for highly sensitive PII — now scoped as defense-in-depth, not a launch mandate).
- `backend/src/modules/auth/*` recovery path (currently plaintext email lookup).
- `AUDIT_2026-06-30.md` Part A MAJOR (ADR-0012 form not implemented).
