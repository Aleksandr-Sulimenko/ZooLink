# ADR-0020: Versioned consent-record model — append-only `consents` log; gate contact-distribution on it

**Status**: **Accepted** (C-3, 2026-08-04 — reconciled to reality: the decision is implemented and live in the schema/code, so the status now matches the truth hierarchy. Migrations 0029 (`consents` append-only log) + 0036 (`seq` monotonic tie-break) + 0040 §C (`REVIEW_PUBLICATION` consent type) landed; `ConsentService.record`/`currentlyGranted` gate contact-distribution; the `contact_prefs` default flip shipped. The Owner-Decisions OD-1/OD-2/OD-3 below were resolved in that build. An Accepted downstream ADR — 0039 "Builds on ADR-0020…0021" — cannot rest on a Proposed upstream: schema ran ahead of the ADR status, and this flip closes that drift.) *Originally: Proposed — ready; awaiting owner nod on the bundled Owner-Decisions OD-1/OD-2/OD-3. The model is a straight application of already-ratified patterns; the open items were product-granularity + a user-visible default flip.*
**Date**: 2026-07-03
**Relates to**: [ADR-0011](0011-agent-principal-actor-model.md) (append-only actor-snapshot + human-override supersede pattern — reused verbatim here), [ADR-0006](0006-ai-agents-operate-platform.md) (`principal_type HUMAN|AGENT` — an AGENT operator may record a consent action), [ADR-0012](0012-pii-at-rest-encryption.md) / [ADR-0019](0019-pii-at-rest-form-enforcement.md) (the `contact_phone` this consent gates is AES-256-GCM at rest — OD-1), [ADR-0005](0005-no-chat-mvp.md) (contact-exchange is the MVP substitute for chat), [ADR-0014](0014-offering-supertype-polymorphic-seam.md)/[ADR-0015](0015-market-scope-refines-0002.md) (consent is subject-scoped, not offering-scoped → survives the ecosystem expansion).
**Legal driver**: `AUDIT3/legal.md` §1 (consent-record model absent — now a go-live A5 blocker), §2 (`contact_prefs` default `show_phone:true` = a LIVE ст.10.1 distribution on a pre-checked default), `docs/legal/consent-personal-data.md` (the four consents draft — ст.10.1 / ст.9 / ФЗ-38 ст.18).

> **WHAT** — Introduce a single append-only, versioned **`consents`** table (migration `0029`) that records every grant/withdrawal of each consent kind, with the ADR-0011 shape: a **new row supersedes** the previous one; the **current consent = the latest row by `(user_id, consent_type)`**; never a mutable flag. `consent_type` is an enum with **`CONTACT_DISTRIBUTION` live now** and **`MARKETING` (ФЗ-38), `ANALYTICS_PROFILING`, `NONESSENTIAL_COOKIES` reserved form-now** (column shape exists, no behaviour reads them yet). Bind behaviour: **contact-reveal distributes a channel only when (a) the seller's current `CONTACT_DISTRIBUTION` consent is `granted=true` AND (b) that channel's `contact_prefs.show_*` is true**; the `contact_prefs` default flips to **`{show_phone:false, show_telegram:false}`** (three code sites). The consent is written at **opt-in via `PATCH /me`**, in the same transaction as the `contact_prefs`/`contact_phone` write.
>
> **WHY** — Contact-reveal is now LIVE (`listing.service.ts` `revealContact` decrypts and returns the seller phone whenever `show_phone` is truthy, and the column **defaults to `true`**). ст.10.1 ФЗ-152 requires a **separate, affirmative, default-OFF** consent for *распространение* to a circle of persons, and ст.9 ч.1 requires the operator to be able to **prove** that consent (text version + timestamp + the UI action). Today the operator distributes phone numbers with **no consent artifact** and on a **pre-checked default** — a direct contradiction of the norm *and* of the operator's own Design-Rule-1 ("default OFF, never pre-checked", `consent-personal-data.md:10`). A `Json` prefs blob cannot be a proof store: it is mutable, unversioned, and overwrites its own history. We need an **append-only, versioned** record — exactly the shape ADR-0011 already ratified for moderation/audit actor-snapshots and human-override.
>
> **WHY-BETTER for the whole project** — (1) **Reuses a ratified pattern, invents nothing new** — the append-only supersede shape, the `actor_id + actor_principal_type HUMAN|AGENT` snapshot, and "current = latest row" are lifted directly from ADR-0011, so the codebase gains one coherent consent/actor idiom rather than a bespoke mechanism. (2) **Forward-compat, anti-rewrite** — reserving `MARKETING`/`ANALYTICS`/`COOKIES` in the enum now means the ФЗ-38 marketing opt-in, analytics/profiling consent and the cookie banner all land as *data*, with **zero schema change** later (the same "form now, behaviour deferred" rule as `feature_toggles.payments`). (3) **Closes a go-live legal blocker cheaply and correctly** — it gives legal the ст.10.1 / ст.9 proof store and the default-OFF the norm demands, *before* any real seller phone is distributed, i.e. while the fix is free. (4) **Agent-ready** — because the actor is snapshotted with `principal_type`, an AI operator (ADR-0006) recording or withdrawing a consent on a subject's behalf is representable and auditable from day one, with the human subject (`user_id`) always distinct from the acting principal (`actor_id`). (5) **Ecosystem-proof** — consent is **subject-scoped** (`user_id`), not offering-scoped, so it survives the ADR-0014/0015 expansion to services/goods without an `OfferingRef` retrofit.

## Context and Problem Statement

`docs/legal/consent-personal-data.md` (DRAFT) mandates a **versioned append-only consent log** as the operator's proof under ст.9 ч.1 ФЗ-152: text version + timestamp + the UI action, with withdrawal as easy as the grant (ст.9 ч.2). Four consents are drafted: **(1) contact distribution (ст.10.1), (2) marketing (ст.9 + ФЗ-38 ст.18 prior opt-in), (3) analytics/profiling (ст.9), (4) non-essential cookies (ст.9)**.

No such store exists. The only near-equivalent is `users.contact_prefs` — a mutable `JSONB` blob that (a) defaults `show_phone:true` (pre-checked — the opposite of ст.10.1), (b) carries no policy version, no timestamp of the affirmative action, and (c) is overwritten on erase/reset, re-enabling distribution for a user who opted out (`retention.service.ts`, `admin-user.service.ts`). Meanwhile contact-reveal is **live** and actively decrypts + distributes the seller phone. The operator cannot produce a single ст.10.1 consent artifact for a distribution that is already happening.

Two forces make the shape non-negotiable:
- **Provability (ст.9 ч.1)** — proof needs an *immutable, versioned* record of *what text* was agreed and *when*; a mutable prefs flag is not proof.
- **Default-OFF (ст.10.1)** — silence/inaction ≠ consent; distribution must be off until an affirmative, separately-recorded act.

This is the same class of requirement ADR-0011 already solved for moderation/audit: an **append-only supersede log with an actor snapshot**. The decision is therefore *which store shape*, not *whether* — and, secondarily, *how the reveal path reads it* and *where the write happens*.

## Decision Drivers

1. **Legal provability & default-OFF (ст.10.1 + ст.9 ч.1/ч.2 ФЗ-152)** — an immutable, versioned, withdrawable record is the statutory proof; default must be no-consent. Highest driver (go-live A5).
2. **Reuse the ratified ADR-0011 pattern** — append-only, "current = latest row", `actor_id + actor_principal_type` snapshot, human-override-by-supersede. Don't invent a second idiom.
3. **Anti-rewrite / forward-compat (§5 phasing)** — reserve the other three consent kinds now so ФЗ-38 marketing, analytics and cookies are behaviour-later, schema-never-again.
4. **Agent-as-principal (ADR-0006/0011)** — the recording actor may be an AGENT; the data subject (`user_id`) must stay distinct from the acting principal (`actor_id`).
5. **Ecosystem-proof (ADR-0014/0015)** — consent is subject-scoped, not tied to a listing/offering, so it needs no `OfferingRef` retrofit.
6. **Two-layer separation** — *lawful basis to distribute at all* (the consent) is distinct from *which channels* (the per-channel `contact_prefs` selector); both required, neither substitutes.
7. **Cheap now, expensive later** — no seller phone has been distributed with a real writer yet (the writer is P1); building the consent gate before the writer lands is free.

## Considered Options

### Option A: Keep `contact_prefs` JSONB, flip the default to OFF, treat the flag as the "consent"
Flip `show_phone` default to `false`; treat a truthy `show_*` as the consent of record; gate reveal on it.

Pros:
- Smallest change; no new table.
- Fixes the pre-checked-default violation.

Cons:
- **Not lawful proof** — a mutable flag has no policy version, no timestamp of the affirmative act, no withdrawal history; fails ст.9 ч.1 provability.
- **Overwritten on erase/reset** — history is destroyed; cannot show *when* or *to what text* the subject agreed.
- No place for the other three consents; each would grow a new ad-hoc field.
- No actor snapshot → an AGENT-recorded consent (ADR-0006) is invisible.

### Option B: Append-only versioned `consents` table in the ADR-0011 shape; reserve all four kinds; gate reveal on it; per-channel selection stays in `contact_prefs` (Chosen)
A new `consents(user_id, consent_type, granted, policy_version, source, actor_id, actor_principal_type, created_at)` append-only log. Current consent = latest row by `(user_id, consent_type)`. Reveal requires the current `CONTACT_DISTRIBUTION` = granted **and** the channel's `show_*` = true. `contact_prefs` default flips to all-OFF and keeps its role as the *per-channel selector* only. Consent written at `PATCH /me` opt-in, same tx.

Pros:
- **Statutory proof** — immutable, versioned, timestamped, withdrawable; exactly ст.9 ч.1/ч.2.
- **One ratified idiom** — identical to ADR-0011's append-only actor-snapshot/supersede; low cognitive + code cost.
- **Forward-compat** — the other three consents are form-now/behaviour-later at zero future schema cost.
- **Agent-ready & subject-scoped** — actor snapshot + `user_id` scope satisfy ADR-0006 and ADR-0014/0015.
- Two-layer model keeps "may I distribute at all" (law) cleanly separate from "which channel" (preference).

Cons:
- One new table + a migration + the reveal-gate wiring (bounded).
- A user-visible behaviour change: contact distribution is OFF until the seller opts in (correct, but a change) — see OD-3.

### Option C: Full separate `consents` + `consent_withdrawals` tables (two-table event-sourced model)
Model grants and withdrawals as two related tables with an explicit link.

Pros:
- Very explicit withdrawal semantics.

Cons:
- Over-engineered for MVP — a single append-only table with `granted BOOLEAN` already expresses withdrawal (a `granted=false` supersede row), matching ADR-0011's single-table supersede exactly.
- Two tables to keep consistent; more join complexity on the read (`current`) path.

## Decision

Adopt **Option B**. Introduce migration `0029` creating an append-only `consents` table in the ADR-0011 supersede shape, reserve all four consent kinds (only `CONTACT_DISTRIBUTION` wired to behaviour now), gate contact-reveal on it, flip the `contact_prefs` default to all-OFF, and write the consent at `PATCH /me` opt-in.

### 1. Table `consents` (migration `0029`, DDL form — canonical shape for backend)

```sql
CREATE TABLE IF NOT EXISTS consents (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- The DATA SUBJECT whose personal data the consent concerns (ст.10.1: whose contacts are distributed).
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Consent kind. CONTACT_DISTRIBUTION is live (ст.10.1); the other three are FORM-NOW / behaviour-deferred
    -- (MARKETING = ст.9 + ФЗ-38 ст.18 prior opt-in; ANALYTICS_PROFILING = ст.9; NONESSENTIAL_COOKIES = ст.9).
    consent_type  VARCHAR(40) NOT NULL CHECK (consent_type IN
                     ('CONTACT_DISTRIBUTION','MARKETING','ANALYTICS_PROFILING','NONESSENTIAL_COOKIES')),
    -- true = grant, false = withdrawal. Withdrawal is a NEW superseding row (ст.9 ч.2: as easy as the grant).
    granted       BOOLEAN NOT NULL,
    -- The version of the consent text the subject agreed to — proof under ст.9 ч.1 (e.g. the
    -- consent-personal-data.md document version passed by the app as a config constant).
    policy_version VARCHAR(20) NOT NULL,
    -- Origin of the affirmative UI action (proof of the action), e.g. 'PROFILE_SETTINGS','REGISTRATION',
    -- 'ADMIN','AGENT'. Free snapshot, no enum CHECK (mirrors ADR-0011 actor_role — kept flexible).
    source        VARCHAR(30) NOT NULL,
    -- ADR-0011/0006 actor snapshot: WHO recorded this action. Normally == user_id (self-service opt-in),
    -- but differs when an operator/AGENT records on the subject's behalf. Subject (user_id) always
    -- distinct from acting principal (actor_id).
    actor_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN'
                            CHECK (actor_principal_type IN ('HUMAN','AGENT')),
    -- Append-only: rows are immutable; no updated_at. A change = a new superseding row.
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Current-consent lookup: latest row per (subject, kind). Serves
--   SELECT granted FROM consents WHERE user_id=$1 AND consent_type=$2 ORDER BY created_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_consents_current ON consents(user_id, consent_type, created_at DESC);
-- Agent-recorded consents (ADR-0006 observability), mirrors idx_users_agents.
CREATE INDEX IF NOT EXISTS idx_consents_agent_actor
    ON consents(actor_principal_type) WHERE actor_principal_type = 'AGENT';
```

- **Append-only enforcement**: add a `BEFORE UPDATE OR DELETE` trigger that raises (same immutability pattern as `audit_log` / the animal-immutability trigger) so history can never be rewritten — this is what makes the log lawful proof. (Backend + migration; negative test required.)
- **Current consent = the latest row by `(user_id, consent_type)`**. There is **no** mutable boolean anywhere that mirrors it; readers always resolve through the log (a thin `ConsentService.currentlyGranted(userId, type)` helper).

### 2. Behaviour binding (contact-reveal)

- **Gate**: `revealContact` distributes a channel **iff** `ConsentService.currentlyGranted(seller_id, 'CONTACT_DISTRIBUTION') === true` **AND** the channel's `contact_prefs.show_*` is true. Consent = *lawful basis to distribute at all* (ст.10.1); `contact_prefs` = *which channels*. If no consent row exists → not granted → distribute nothing (default-deny). This also fixes the billing-unit bug: **check consent + channels first, and only then** burn quota / write the `contact_reveals` row / emit the lead event (never on an empty reveal).
- **Default flip (three sites, migration `0029` + code)**: `contact_prefs` column DEFAULT → `'{"show_phone": false, "show_telegram": false}'`; and the two code copies `DEFAULT_CONTACT_PREFS` in `admin-user.service.ts` and `retention.service.ts` → same all-OFF value, so an admin reset or the retention reset never re-enables distribution.

### 3. Write point (opt-in) — `PATCH /me`

- The Identity `PATCH /me` handler is the single writer. When the seller opts in (sets a contact channel on / grants distribution), the handler, **in the same transaction** as the `contact_prefs` / `contact_phone` update, appends a `consents` row: `consent_type='CONTACT_DISTRIBUTION'`, `granted=true`, `policy_version=<current>`, `source='PROFILE_SETTINGS'`, `actor_id=<subject or operating principal>`, `actor_principal_type=<HUMAN|AGENT>`. **Withdrawal** (turning distribution off / all channels off) appends a `granted=false` row — never an UPDATE. Registration does **not** grant it (unbundled — Design-Rule-2); default stays no-consent.

### 4. Scope guard (what this ADR does NOT do)
- Does **not** wire `MARKETING`/`ANALYTICS_PROFILING`/`NONESSENTIAL_COOKIES` behaviour — enum reserved, no reader (ФЗ-38 double-opt-in etc. are a later slice).
- Does **not** design the UX of the consent toggle (ux-designer) — see **OD-2**.
- Does **not** change the `contact_phone` at-rest form (ADR-0019 owns that).

## Owner-Decisions (bundled — one-pass ratification requested)

- **OD-1 — Ratify the seam.** Approve the append-only `consents` table (migration `0029`) with `CONTACT_DISTRIBUTION` live now and `MARKETING`/`ANALYTICS_PROFILING`/`NONESSENTIAL_COOKIES` reserved form-now. *(Recommend: yes — it is the ADR-0011 pattern applied, and closes go-live blocker A5.)*
- **OD-2 — Consent granularity (product/UX).** Is `CONTACT_DISTRIBUTION` a **dedicated** opt-in action ("Allow interested buyers to see my contacts"), with `show_phone`/`show_telegram` as sub-selectors of *which* channel — **or** is enabling any channel *itself* the affirmative consent act? *(Recommend: dedicated umbrella consent + per-channel sub-selectors — cleanest ст.10.1 proof and matches the legal draft's granular-consent rule. Final UX → ux-designer.)*
- **OD-3 — Confirm the default flip.** Confirm `contact_prefs` default → `show_phone:false` (a user-visible behaviour change: contact distribution is OFF until the seller opts in) across the column default + the two code copies. *(Recommend: yes — required by ст.10.1 and by the operator's own Design-Rule-1; low risk since no real writer has populated it yet.)*

## Consequences

### Positive
- The operator can prove every ст.10.1 distribution consent (version + timestamp + action) and every withdrawal — go-live blocker A5 closed at the model level.
- Default-deny distribution; no more pre-checked PII sharing; erase/reset no longer re-enables it.
- One coherent consent/actor idiom shared with ADR-0011; agent-recorded consents are auditable (ADR-0006).
- ФЗ-38 marketing, analytics and cookie consents are a behaviour-only future slice — no further schema change.

### Negative
- One new table + migration `0029` + reveal-gate wiring + the `PATCH /me` writer (bounded; largely the P1 contact-writer work the audit already scoped).
- A user-visible default change (distribution OFF until opt-in) — surfaced as OD-3, not slipped in.

### Neutral
- `contact_prefs` remains, narrowed to a *per-channel selector*; the *lawful-basis* question moves to `consents`.
- `policy_version` is a plain string tied to the consent-doc version — no FK to a policy table in MVP (a policy-registry table is a possible later refinement, not needed now).

## Implementation Notes — build-spec for backend-engineer

1. **Migration `0029`** (idempotent, run-twice, negative tests): create `consents` + the two indexes + the append-only `BEFORE UPDATE OR DELETE` guard trigger; flip the `contact_prefs` column DEFAULT to all-OFF. Update `database_schema.sql`, the `ZooLink/CLAUDE.md` migration ledger (→ 36 tables), `ZooLink_ERD.mmd`, `docs/03-architecture/data-model.md` (hand ERD + data-model to **doc-keeper**).
2. **`ConsentService`** (Identity domain): `record(userId, type, granted, policyVersion, source, actorId, actorPrincipalType)` (append-only insert) and `currentlyGranted(userId, type): boolean` (latest-row read via `idx_consents_current`).
3. **`PATCH /me`**: in the same tx as the `contact_prefs`/`contact_phone` write, call `ConsentService.record(...)` for `CONTACT_DISTRIBUTION` (grant on opt-in, `granted=false` on opt-out). Do **not** grant at registration (unbundled).
4. **`revealContact`**: gate on `currentlyGranted(seller_id,'CONTACT_DISTRIBUTION') && show_*`; **check first**, then burn quota / write `contact_reveals` / emit the lead event (fixes the empty-reveal billing bug). Default-deny on no consent row.
5. **Three default-flip sites**: column DEFAULT (migration) + `DEFAULT_CONTACT_PREFS` in `admin-user.service.ts` and `retention.service.ts` → `{show_phone:false, show_telegram:false}`.
6. **Tests (DoD)**: negative test for the append-only trigger (UPDATE/DELETE rejected); reveal returns `{}` with no consent even when `show_phone=true`; reveal returns the channel only when both consent + `show_*` hold; withdrawal (`granted=false` row) flips a subsequent reveal to `{}`; AGENT-actor consent row round-trips; erase/reset leaves distribution OFF. Replace the masking fixture that seeds phone directly (`listing-contact-sold.e2e`) with an honest register→opt-in→reveal path.
7. **Do NOT touch** auth/config/animal/listing security slices beyond the `revealContact` gate and the `PATCH /me` writer — those slices are complete and awaiting commit.
8. **Actor semantics**: `user_id` = subject; `actor_id` = who recorded (normally equal). Never conflate them — an operator/AGENT recording on behalf must set `actor_id` to the operating principal and `actor_principal_type` accordingly (ADR-0006/0011).

## Related Decisions
- **ADR-0011** — append-only actor-snapshot + supersede pattern (this ADR reuses it wholesale).
- **ADR-0006** — `principal_type HUMAN|AGENT`; an AI operator may record/withdraw a consent.
- **ADR-0012 / ADR-0019** — the `contact_phone` this gate distributes is AES-256-GCM at rest.
- **ADR-0005** — contact-exchange is the MVP no-chat substitute this consent governs.
- **ADR-0014 / ADR-0015** — consent is subject-scoped, so it survives the offering/ecosystem expansion.

## References
- `AUDIT3/legal.md` §1 (consent-record model absent → go-live A5), §2 (`show_phone:true` pre-checked default = live ст.10.1 distribution).
- `docs/legal/consent-personal-data.md` — the four consents (ст.10.1 / ст.9 / ФЗ-38 ст.18); Design-Rules 1–4 (granular / unbundled / revocable / recorded).
- **ФЗ-152 ст.10.1** (распространение — separate default-OFF consent), **ст.9 ч.1** (proof of consent), **ст.9 ч.2** (withdrawal as easy as grant); **ФЗ-38 ст.18** (prior opt-in for advertising — reserved `MARKETING`).
- `database_schema.sql` (users.contact_prefs default; audit_log/moderation_decisions actor-snapshot precedent).
- `AUDIT3_FORWARD_COMPAT.md` P1.1 (contact-channel writer + default flip) & P2 (versioned consent-record model seam).
