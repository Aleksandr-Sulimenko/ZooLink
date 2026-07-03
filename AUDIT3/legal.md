# ZooLink HYPER² Audit — Round 3 · legal (RF-first compliance, forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) · **Role:** legal specialist
**Method:** independent forward-compat + legal-launch-gate pass over schema/code/ADRs/legal-docs
first (without reading round-1/2), then diffed against `AUDIT2/legal.md`.

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line/norm → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO · Criterion ∈ pii · go-live · marketing ·
fiscal · rx · intermediary · species · reviews · ai-operator · consistency.

> **EARLY-STAGE POSTURE — RECORD, NOT BLOCK.** Per my charter I am record-only at this stage: I do
> not halt the build. "go-live gate" below means *a gate the owner must clear before public launch*,
> not a stop on the current work. Where a norm is uncertain I write **требует ручной проверки** and
> do not invent law. Analysis dated 2026-07-02; RF law changes — re-verify редакция before reliance.
> Advisory only; final go/no-go and signatures are the owner's.

---

## 0. Headline — what moved since Round 2

Two facts changed the picture, both discovered by re-checking the code (not the docs):

1. **Contact-reveal is now LIVE** (`listing.service.ts:444` `revealContact`, commit `aa3ae3b`,
   HEAD msg "closes contact_reveals/sold_at CRITICALs"). It **actively decrypts `contact_phone`
   and returns it** whenever `contact_prefs.show_phone` is truthy — and that column **defaults to
   `true`**. Round 2 (§2a) reasoned this was "inert / forward-compat — contact-reveal returns empty
   channels." **That premise is now false.** The most sensitive PII is being distributed on a
   **pre-checked default** with **no ст.10.1 consent record**. → SEV-CHG **up**.
2. **`prohibited_species` IS seeded** (`database_schema.sql:1339` moderation_reasons + `:1359`
   reject template). Round 2 (§3g) left this as "seed unverified — требует ручной проверки" and
   called checklist B2 "at minimum imprecise." Verified: the B2 "already seeded" claim is **correct**
   for the moderation/rejection path. → SEV-CHG **down** (residual is only the user-facing report enum).

Everything else from Round 2 holds. The 06-30 ФЗ-152 wave-fixes (lawful basis ст.6 ч.1 п.5,
breach 24h+72h ст.21 ч.3.1, РКН notice ст.22, residency ст.18 ч.5) remain substantively correct.

---

## 1. Consent-record MODEL still absent — now urgent, not just forward-compat

`[CRITICAL][marketing][CONFIRMED] backend/prisma/schema.prisma (users.contact_prefs Json) / ст.9 ч.1, ст.10.1 ФЗ-152, ФЗ-38 ст.18 → the consent draft (consent-personal-data.md:13,48) mandates a versioned append-only consent log (text version + timestamp + UI action = proof under ст.9 ч.1; withdrawal as easy as grant, ст.9 ч.2). No consents/consent_log table exists (grep: only users.contact_prefs Json + audit_log). There is nowhere to prove a marketing (ФЗ-38 ст.18 prior opt-in) or a distribution (ст.10.1) consent → reserve a form-now append-only seam consents(subject_id, kind, text_version, action, granted_at, withdrawn_at) BEFORE notification/marketing OR contact-distribution proof is needed; keep transactional vs marketing channels separate; double-opt-in for marketing. RECORD (non-blocking build; go-live gate).`

Why this is more pressing than Round 2 framed it: with contact-reveal now live (§0.1), the
**ст.10.1 distribution proof store is needed at go-live, not "when marketing ships."** The operator
is already distributing seller phone numbers and cannot produce a single ст.10.1 consent artifact.

## 2. contact_prefs default `show_phone: true` — LIVE pre-consented ст.10.1 distribution

`[CRITICAL][pii][SEV-CHG] database_schema.sql:972-973 (DEFAULT '{"show_phone": true, "show_telegram": false}') + backend/src/modules/listing/listing.service.ts:470 / ст.10.1 ФЗ-152 → SEV-CHG up from R2 §2a MAJOR-forward-compat. revealContact() now decrypts and returns seller phone whenever prefs.show_phone is truthy, and the column defaults to true → any authorized viewer can pull a seller's phone that the seller never affirmatively agreed to distribute. ст.10.1 requires a SEPARATE, affirmative, default-OFF consent for распространение to a circle of persons; silence/inaction ≠ consent; the operator's OWN draft Design-Rule-1 (consent-personal-data.md:10) says "default OFF, never pre-checked." The default violates both the norm and the draft, and it is now on a live code path → (a) flip the column default to {show_phone:false, show_telegram:false}; (b) gate the reveal on an explicit ст.10.1 consent record (§1 seam) — contact_prefs alone is not lawful proof; (c) also flip the two code copies of DEFAULT_CONTACT_PREFS (admin-user.service.ts:36, retention.service.ts:14) so erase/reset does not re-enable distribution. RECORD (non-blocking build; go-live gate).`

Note the erase/reset paths (`retention.service.ts:132`, `admin-user.service.ts:225`) reset
`contact_prefs` to `show_phone:true` — so even a user who opted out has phone-distribution
re-enabled after an admin reset or the retention reset. Same fix, three sites.

## 3. Go-live artifacts — DRAFT, honestly labelled, no false "published"

`[MAJOR][go-live][CONFIRMED] docs/legal/{public-offer,terms-of-service,privacy-policy,consent-personal-data,launch-compliance-checklist,README}.md / ст.435–438 ГК; ст.18.1 ч.2 п.2 ФЗ-152 → all six artifacts + RU mirror carry STATUS: DRAFT; README sign-off log (README.md:31) shows counsel-review/approved/published all unchecked; no false "published" claim survives (verified privacy-policy.md:1,3; public-offer.md:3; ToS:1,3). Every [operator-identity]/[DPO]/[processor] placeholder is unfilled; no retained-counsel review; not published/footer-linked → until published & accepted the ст.6 ч.1 п.5 contract basis is UNGROUNDED (docs say so, README:7 + checklist A1) → owner: pick+register the operator entity (checklist B1), fill placeholders, counsel-review, publish+footer-link before public launch. RECORD (non-blocking build; go-live gate A1).`

## 4. RF data-residency (ст.18 ч.5) — requirement documented; ADR still Proposed, guardrail NOT built

`[MAJOR][pii][CONFIRMED] docs/04-decisions/0017-rf-data-residency.md:3 (Status: Proposed) + docs/specs/deployment/deployment_specification.md:70,105 / ст.18 ч.5 ФЗ-152 → the residency requirement is correctly captured (checklist A3, ADR-0017 Option 3 = RF-only primary+replicas+backups+DR, de-identified carve-out under ст.12) BUT the ADR is still Proposed (topology/cost awaiting owner), the deployment spec still carries UNCONSTRAINED cross-region replication/DR language, and the CI/deploy "fail-on-non-RF-region" guardrail (ADR-0017 §8) is NOT built → owner: ratify ADR-0017 topology; devops: encode region-pinning + the guardrail before any RF-citizen PII exists (free now, costly after data lands). This is the PRIMARY ФЗ-152 go-live floor (ranked above РКН notice). RECORD (non-blocking build; go-live BLOCKER A3).`

## 5. PII-at-rest form (ADR-0019) — built AND now exercised (strength)

`[INFO][pii][CONFIRMED] migration 0028 + backend/src/lib/crypto/CryptoService + listing.service.ts:471 / ст.19 ФЗ-152, приказ ФСТЭК №21 → ADR-0019 Accepted+owner-ratified; email is AES-256-GCM encrypted + HMAC blind-indexed; contact_phone is now encrypted-at-rest and decrypted only at reveal (sub-wave C shipped — the form is no longer dormant, it is on a live path). Residual: the "certified СКЗИ under приказ ФСТЭК №21" question is a tracked legal investigation, non-blocking for the seam (ADR-0019 Status) → keep tracking СКЗИ certification; verify редакция ФСТЭК №21 before reliance — требует ручной проверки. Strength, not a gap. RECORD.`

## 6. 54-ФЗ ККТ on boost/premium — captured, no module (confirmed)

`[INFO][fiscal][CONFIRMED] docs/legal/launch-compliance-checklist.md:29 (C1) / 54-ФЗ; ЗоЗПП → boost/premium are the Operator's OWN B2C services → ККТ/фискальный чек applies REGARDLESS of feature_toggles.payments (correctly stated). Only a stub payment adapter exists (lib/providers/payment/stub-payment.adapter.ts); no boost/premium billing module → when any own paid service ships: wire ОФД fiscal-receipt issuance, choose marketplace-vs-payment-agent model, apply ЗоЗПП to own services; if funds are ever held → 115-ФЗ/161-ФЗ (C2). Seam reserved in doc. RECORD (non-blocking; conditional gate C1).`

## 7. prohibited_species / CITES — seed EXISTS; residual is only the user report enum

`[MINOR][species][REFUTED] database_schema.sql:1339 (moderation_reasons 'prohibited_species') + :1359 (prohibited_species_reject template) / CITES; ст.258.1 УК РФ; 498-ФЗ → REFUTES R2 §3g's "seed unverified / B2 imprecise": the moderation_reasons rejection seed DOES contain prohibited_species, so checklist B2 "already seeded" is CORRECT for the moderation path. SEV-CHG down (R2 MAJOR → MINOR). Residual: the user-facing content-report reason enum (content-report.dto.ts:20 = SPAM/ABUSE/FRAUD/INAPPROPRIATE/OTHER) still lacks a CITES/Red-Book/ст.258.1 option, so a user cannot flag a prohibited-species listing under a specific reason → add a CITES/prohibited-species content-report reason; publish the prohibited-species policy in the Rules (B2). RECORD (non-blocking).`

## 8. AI-as-operator legal framing (ADR-0006) — framed in docs, not yet a product surface

`[MAJOR][ai-operator][CONFIRMED] docs/04-decisions/0006-ai-agents-operate-platform.md + checklist B5 + ADR-0011 (human-override built: migration 0016 is_human_override/supersedes_decision_id) / transparency principle, ADR-0006 → the accountability chain is legally sound in design: actor_principal_type HUMAN|AGENT recorded on moderation_decisions/audit_log, append-only human-override supersede row, and checklist B5 requires "automated-decision disclosure + human-appeal path." BUT B5 is ☐ — the consumer-facing disclosure ("this decision may be automated; appeal to a human via [channel]") is not yet a shipped product surface, and the ToS appeal clause (terms-of-service.md:49) references a placeholder [appeal channel] → when moderation/decisions face users: ship the automated-decision disclosure + human-appeal channel; fill the ToS placeholder. Foundation strong; the disclosure surface is the open item. RECORD (non-blocking; go-live gate B5).`

## 9. Informational-intermediary + reviews defamation — unchanged from R2

`[INFO][intermediary][CONFIRMED] docs/04-decisions/0016-provider-model.md + checklist B4 / ст.1253.1 ГК; ФЗ-149 ст.10; ЗоЗПП «владелец агрегатора» → the three-regime immunity model is correctly framed; the shield holds only while a working takedown channel (B4, still ☐/placeholder) is published and the operator stays a neutral venue → publish the takedown/abuse channel before launch; do not curate beyond lawful moderation. RECORD (non-blocking; go-live gate B4).`

`[MAJOR][reviews][CONFIRMED] docs/01-discovery/future-features.md:213 / ст.152 ГК → Reviews/Ratings still deferred with no removal/rebuttal (право на опровержение) procedure reserved; defamation/честь-достоинство exposure is distinct from the ст.1253.1 content shield → when reviews ship, reserve a review-removal + right-of-reply procedure + author-identity retention; tie into the content-report takedown channel. RECORD (non-blocking; forward-compat seam).`

## 10. MINOR — privacy-policy lawful-basis cell wording (unchanged)

`[MINOR][pii][CONFIRMED] docs/legal/privacy-policy.md (security/fraud/audit cell) / ст.6 ч.1 п.2 vs п.5 ФЗ-152 → cell mixes ст.6 ч.1 п.2 (processing required by law) with a GDPR-flavoured "legitimate operation" phrase; п.2 is narrow — fraud-prevention is better grounded on п.5 (contract) or a specific legal duty → tighten to the precise basis; требует ручной проверки (сверить основание). RECORD (non-blocking).`

---

## Diff vs AUDIT2/legal.md

| # | Round-3 finding | vs R2 | Δ |
|---|---|---|---|
| 1 | Consent-record model absent | R2 §2 CRITICAL | **CONFIRMED** (urgency raised — distribution proof now needed at go-live) |
| 2 | contact_prefs default show_phone:true | R2 §2a MAJOR "inert/forward-compat" | **SEV-CHG ↑** MAJOR→CRITICAL (reveal is now LIVE) |
| 3 | Go-live artifacts DRAFT, honest | R2 §1 MAJOR | **CONFIRMED** |
| 4 | RF residency ст.18 ч.5 — ADR Proposed, guardrail unbuilt | R2 §0 (framed as present) | **CONFIRMED** (added: ADR still Proposed, guardrail NOT built) |
| 5 | PII-at-rest form built + now exercised | R2 (ADR-0019 noted) | **CONFIRMED** (added: contact_phone path now live) |
| 6 | 54-ФЗ boost/premium | R2 §3a INFO | **CONFIRMED** |
| 7 | prohibited_species seed | R2 §3g MAJOR "unverified" | **REFUTED / SEV-CHG ↓** → MINOR (seed exists; only report enum gap) |
| 8 | AI-as-operator disclosure surface | R2 (not isolated) | **NEW** (ADR-0006/B5 disclosure surface not shipped) |
| 9 | Intermediary shield / reviews ст.152 | R2 §3d,§3f | **CONFIRMED** |
| 10 | privacy-policy basis wording | R2 §3h MINOR | **CONFIRMED** |

**Counters:** NEW 1 · CONFIRMED 7 · REFUTED 1 · SEV-CHG 2 (one ↑, one ↓; the REFUTED item is the down SEV-CHG).

---

## Go-live legal BLOCKERs (current, ranked)

1. **A3 — RF data-residency (ст.18 ч.5 ФЗ-152).** ADR-0017 still *Proposed*; deployment spec
   unconstrained; CI/deploy guardrail unbuilt. Primary ФЗ-152 floor. (§4)
2. **A1 — Publish offer/ToS/privacy (ст.435–438 ГК; ст.18.1 ч.2 п.2 ФЗ-152).** All DRAFT,
   placeholders unfilled, no counsel review — lawful basis ungrounded until published+accepted. (§3)
3. **A2 — File the РКН processing notification (ст.22 ФЗ-152)** before processing begins. (owner)
4. **A4 — Designate ответственный за обработку ПДн (ст.22.1 ФЗ-152)**; publish in privacy policy. (owner)
5. **A5 — ст.10.1 distribution consent for the LIVE contact-reveal (ст.10.1 + ст.9 ФЗ-152).**
   Now a real, not hypothetical, blocker: reveal distributes phone on a pre-checked default with
   no consent record. Fix = consent-record seam (§1) + default-OFF flip (§2) + gate reveal on consent. (§1,§2)

**Conditional (only if the toggle/feature flips ON):** 54-ФЗ ККТ on any own paid service incl.
boost/premium regardless of payments toggle (§6, C1); 115-ФЗ if funds held (C2); ФЗ-38 marketing
opt-in + consent store (§1, C3); ОРИ re-assessment if chat added (C4); ст.12 cross-border review (C5).

**Non-blocking go-live gates (owner, cheaper than blockers):** B4 takedown channel (§9),
B5 automated-decision disclosure surface (§8), B1 operator entity, B2 prohibited-species Rules content (§7),
B3 livestock vet disclaimer, trademark clearance (recommended, not a blocker).

All findings above are **RECORD (non-blocking)** for the current build — durable knowledge and
launch gates, not a stop on development.
