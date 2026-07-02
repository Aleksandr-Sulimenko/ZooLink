# ZooLink HYPER Audit — Phase 2 · legal (RF-first compliance, forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Role:** legal specialist
**Method:** verified the 2026-07-01 legal wave (commit `aec19d1`) + ecosystem ADRs (0016/0017/0019)
against the actual code (schema, seeds, moderation/listing modules), then mapped the forward-compat
regulated-side seams for when the gated tracks ship.

Finding format: `[severity][criterion][legal] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO · Criterion ∈ pii · go-live · marketing ·
fiscal · rx · intermediary · provider · reviews · species · consistency.

> **EARLY-STAGE DISCOUNT — RECORD, NOT BLOCK.** Everything below is **RECORD (non-blocking)**
> durable knowledge laid down for when the regulated/monetized side ships. Nothing here halts the
> current build. Where a norm is uncertain I write **требует ручной проверки (сверить норму)** and
> do not invent law. I am **recording, not blocking.**

> Analysis dated 2026-07-02. RF law is interpreted and changes — re-verify every cited article is in
> force before any go-live reliance. This is advisory; final go/no-go and signatures are the owner's.

---

## 0. Wave-fix verdict — did commit `aec19d1` actually fix the ФЗ-152 errors? ✅ YES (verified)

**RECORD (non-blocking) — all four 06-30 legal errors are corrected in-repo; no stale text remains.**

- **Lawful basis FIXED.** The GDPR "legitimate interest" (art.6(1)(f)) error is gone from all
  normative text. Core processing now correctly runs on **ст.6 ч.1 п.5 ФЗ-152** (contract
  performance = публичная оферта), with **ст.9 / ст.10.1** reserved for the *separate* consents.
  Verified: `docs/02-requirements/nfr/security.md:181-185`, `docs/legal/privacy-policy.md:28`,
  `docs/legal/public-offer.md:38`, `docs/legal/consent-personal-data.md:4-5`. The only surviving
  "legitimate interest" strings are the explanatory "replaced X with Y" annotations — correct.
- **Breach window FIXED.** Single "72h" (GDPR art.33) replaced with the RF two-stage duty
  **24h (fact) + 72h (investigation result)** to РКН under **ст.21 ч.3.1 ФЗ-152** (ред. ФЗ-266/2022).
  Verified `nfr/security.md:174`. Checklist B6 mirrors it.
- **РКН processing notification** present as a go-live blocker: **ст.22 ФЗ-152**, checklist A2.
- **Data residency** present: **ст.18 ч.5 ФЗ-152** → ADR-0017 (RF-only primary+replicas+backups+DR),
  checklist A3. Ranked floors are correct (residency > РКН notice > lawful basis; ADR-0019:29).

**Verdict: the wave is substantively correct and the ranked ФЗ-152 floors are right.** Confidence
high on the framing; the usual "re-verify редакция" caveat applies (they carry it themselves).

`[INFO][pii][legal] docs/02-requirements/nfr/security.md:181 → 06-30 lawful-basis/breach/РКН/residency errors all corrected by commit aec19d1; no stale GDPR-legitimate-interest or single-72h text survives in normative sections → none; keep the "verify редакция before launch" caveat. RECORD (non-blocking).`

---

## 1. Go-live artifacts — status: BLOCKER RESOLVED to DRAFT (0 files → 6 files); honestly labelled

**RECORD (non-blocking).** The 06-30 BLOCKER (0 legal documents in repo) is resolved: six artifacts
now exist — `docs/legal/{public-offer, terms-of-service, privacy-policy, consent-personal-data,
launch-compliance-checklist, README}.md` + full RU mirror (RU is the operative text). They are
**correctly marked DRAFT** and **do NOT falsely claim "published"** — the README sign-off log
(`docs/legal/README.md:30-36`) shows every doc's *counsel-review / approved / published* boxes
unchecked, and the old false "published" line in `nfr/security.md` was corrected to
"DRAFTED, awaiting owner sign-off + publication" (`nfr/security.md:198-199`). No residual
doc↔reality "published" lie found in the requirements tree.

**What still gates go-live (owner actions, not code):** every `[…]` placeholder (operator identity
ИП/ООО/самозанятый, DPO name, processor list) is unfilled; no retained-counsel review; not
published+footer-linked. Until published & accepted, the ст.6 ч.1 п.5 contract basis is **not yet
grounded** — the docs state this correctly (README:7, checklist A1). No action for the build now.

`[MAJOR][go-live][legal] docs/legal/README.md:31 → go-live artifacts exist only as unsigned DRAFTs with unfilled [operator-identity] placeholders + no counsel review; lawful basis ст.6 ч.1 п.5 is ungrounded until offer published & accepted → owner: pick+register the operator entity, fill placeholders, counsel-review, publish+footer-link before any public launch (checklist A1-A5). RECORD (non-blocking) — this is a launch gate, not a build gate.`

---

## 2. ⭐ TOP FORWARD-COMPAT SEAM — no consent-record MODEL is reserved in the schema

**RECORD (non-blocking) — the single most important seam to reserve cheaply now.**

The consent draft (`consent-personal-data.md:13,48`) is emphatic that every ст.9 / ст.10.1 / ФЗ-38
consent must be **"Recorded" — store consent text VERSION, TIMESTAMP, and the UI ACTION (proof of
consent)**, in an append-only **consent log**, with **withdrawal logged** as easily as grant
(ст.9 ч.2). It maps four consents (distribution ст.10.1, marketing ст.9+ФЗ-38, analytics, cookies)
to "consent log".

**But that consent log does not exist in code.** `grep -ri consent backend/{src,prisma}` finds
**only** `users.contact_prefs Json` (`schema.prisma:662`) — a `{show_phone, show_telegram}` boolean
blob. There is **no** `consents` / `consent_log` table, no version column, no timestamp-of-action,
no withdrawal record, nowhere to prove a *marketing* opt-in at all. When the retention/notification
engine ships marketing (ФЗ-38 ст.18 requires **prior, provable opt-in**; transactional≠advertising;
double-opt-in is best practice) and when contact-reveal actually *distributes* contacts (ст.10.1
requires a **separate distribution consent**), the operator will have **no ст.9 ч.1 proof store** to
show РКН, and retrofitting a versioned append-only consent log over a live user base is the exact
anti-rewrite scenario ADR-0012/0019 warn against. This seam is **free to reserve now** (empty table
+ a `record_consent(subject, kind, version, action, ts)` seam), costly later.

`[CRITICAL][marketing][legal] backend/prisma/schema.prisma:662 → consent draft mandates a versioned append-only consent log (proof under ст.9 ч.1 / ст.10.1 / ФЗ-38 ст.18) but schema has only users.contact_prefs Json — no consents table, no version/timestamp/action/withdrawal, no marketing opt-in store at all → reserve a form-now consent-record seam (append-only consents(subject_id, kind, text_version, action, granted_at, withdrawn_at)) BEFORE notification/marketing ships; transactional vs marketing MUST be separate channels; double-opt-in for marketing. RECORD (non-blocking).`

### 2a. Sub-finding — `contact_prefs` defaults `show_phone: true` — pre-consented distribution

**RECORD (non-blocking).** The column default is `{"show_phone": true, "show_telegram": false}`
(`schema.prisma:662`). Under **ст.10.1 ФЗ-152**, распространение of PII to a circle of users requires
a **separate, affirmative, default-OFF consent** — silence/inaction is not consent, and the consent
draft's own Design Rule 1 says "default OFF, never pre-checked" (`consent-personal-data.md:10`). A
default that *pre-enables* phone distribution contradicts both the norm and the operator's own draft
the moment contact-reveal actually surfaces a phone. (Today it's inert — active-user found
contact-reveal returns empty channels — so this is forward-compat, but the default is already wrong.)

`[MAJOR][pii][legal] backend/prisma/schema.prisma:662 → contact_prefs defaults show_phone:true = pre-consented ст.10.1 distribution, contradicting default-OFF rule (consent draft §Design-Rule-1) → flip default to all-OFF; gate any contact distribution on an explicit ст.10.1 consent record (§2 seam). RECORD (non-blocking).`

---

## 3. Ecosystem forward-compat — regulated-side seams (record for the gated tracks)

### 3a. 54-ФЗ ККТ on boost/premium — captured in doc, no module yet ✅
`[INFO][fiscal][legal] docs/legal/launch-compliance-checklist.md:29 → checklist C1 correctly states boost/premium are the Operator's OWN B2C services → 54-ФЗ (ККТ/чек) applies REGARDLESS of the payments toggle; no boost/premium module exists yet → when any own paid service ships, wire fiscal-receipt (ОФД) issuance + choose marketplace-vs-payment-agent model + ЗоЗПП for own services. Seam reserved in doc. RECORD (non-blocking).`

### 3b. ФЗ-38 marketing consent — see §2 (the consent MODEL is the missing piece)
Checklist C3 + consent draft §Consent-2 correctly require prior opt-in + unsubscribe-in-every-message;
the gap is purely the absent record store (§2). RECORD (non-blocking).

### 3c. 61-ФЗ + Пост.697 Rx-OFF gating — locked in docs, module not built ✅
`[INFO][rx][legal] docs/01-discovery/future-features.md:155 → Rx/prescription vet-medicine track correctly locked OFF at launch (61-ФЗ; Пост.Прав.№697/2020; drug-ad 38-ФЗ ст.24) behind a feature_toggle + pharmacy licence + legal opinion (ToS:30, ADR-0016 T3, OD-5); no goods/pharmacy module built yet → when goods ships, Rx MUST be feature_toggle default-OFF, server-side hard-gated, licence-verified (ADR-0016 regulated-publish gate). Probe reserved (§probes). RECORD (non-blocking).`

### 3d. Informational-intermediary (ст.1253.1 ГК) + aggregator (ЗоЗПП) — well modelled ✅
`[INFO][intermediary][legal] docs/04-decisions/0016-provider-model.md:MODEL → the three-regime immunity model (ст.1253.1 ГК for content/IP; ЗоЗПП «владелец агрегатора» for service-info accuracy; "don't become the executor" doctrine for guarantee/control/settlement) correctly frames platform liability; intermediary shield holds only while a working takedown channel (checklist B4, ФЗ-149 ст.10) exists and the operator stays a neutral venue → keep the takedown channel live; do not curate/author beyond lawful moderation. RECORD (non-blocking).`

### 3e. Provider-license verification as immunity condition (ADR-0016 / 498-ФЗ / ВетИС) ✅
`[INFO][provider][legal] docs/04-decisions/0016-provider-model.md:31 → verification T0–T3 tier matrix + derived (not client-asserted) badge conditions the regulated-publish gate and legal posture; provider module not built yet → when ServiceOffering/ProductOffering ship, the DB-enforced server-side regulated-publish hard-gate + tamper-proof append-only verification record (ADR-0016 DoD gates) MUST precede any regulated-category listing. Seam reserved in ADR. RECORD (non-blocking).`

### 3f. Reviews-removal procedure (ст.152 ГК) — NOT reserved
**RECORD (non-blocking).** Reviews/Ratings are deferred (`future-features.md:213`); no review/rating
model exists in code (only moderation "review"). When reviews ship they carry **defamation /
честь-достоинство exposure (ст.152 ГК)** distinct from the ст.1253.1 content shield: the operator
needs a **review-removal / rebuttal procedure** (subject's right to demand removal of untrue
defamatory statements; operator's safe-harbour depends on a working takedown + right-of-reply). No
such seam is reserved. Cheap to note now.

`[MAJOR][reviews][legal] docs/01-discovery/future-features.md:213 → Reviews/Ratings deferred with no ст.152 ГК removal/rebuttal procedure reserved; defamation exposure is distinct from the ст.1253.1 content shield → when reviews ship, reserve a review-removal + right-of-reply procedure + author-identity retention (for защита чести); tie into the existing content-report takedown channel. RECORD (non-blocking).`

### 3g. prohibited_species (CITES / ст.258.1 УК) — doc↔reality gap
**RECORD (non-blocking).** Checklist B2 asserts "`prohibited_species` reason **already seeded**",
but `grep -ri prohibited backend` finds **nothing** — the content-report reason enum is
`['SPAM','ABUSE','FRAUD','INAPPROPRIATE','OTHER']` (`content-report.dto.ts:20`), with no
prohibited-species/CITES/Red-Book option, so a user cannot flag a CITES / ст.258.1 УК listing under
a specific reason. Whether a `prohibited_species` code exists in the `moderation_reasons` *seed*
(rejection reasons, a different table) **требует ручной проверки (сверить сид)** — but the B2
"already seeded" claim is at minimum imprecise against the report path.

`[MAJOR][species][legal] backend/src/modules/moderation/dto/content-report.dto.ts:20 → checklist B2 claims prohibited_species reason "already seeded" but no prohibited/CITES/Red-Book code exists in the content-report reason enum (SPAM/ABUSE/FRAUD/INAPPROPRIATE/OTHER); moderation_reasons seed unverified → add a CITES/ст.258.1/Красная-книга report+rejection reason, publish prohibited-species policy in Rules (checklist B2); verify moderation_reasons seed — требует ручной проверки (сверить сид). RECORD (non-blocking).`

### 3h. MINOR — privacy-policy lawful-basis cell loose wording
`[MINOR][pii][legal] docs/legal/privacy-policy.md:29 → security/fraud/audit cell mixes ст.6 ч.1 п.2 (processing required by law/treaty) with the GDPR-flavoured phrase "legitimate operation of the service"; п.2 is narrow (legal obligation), fraud-prevention is better grounded on п.5 (contract) or a specific legal duty → tighten wording to the precise basis; требует ручной проверки (сверить основание). RECORD (non-blocking).`

---

## Compliance probes  (assertable checks for Phase-3 / future gates)

Concrete, machine-checkable probes a future gate can assert. Most are **future** (guard the seam
before the regulated track ships); a few are **assertable today**.

**P-1 (today) — no false "published" claim.** Assert no requirements/legal doc states legal
artifacts are "published/опубликованы" while `docs/legal/README.md` sign-off log has an unchecked
`Published` box. (Grep-gate: `published` in normative text ⇒ README Published ☑.)

**P-2 (today) — DRAFT status honesty.** Assert every file in `docs/legal/` carries `STATUS: DRAFT`
until the README sign-off row is fully checked.

**P-3 (future, marketing) — consent record exists before marketing send.** Assert: no
marketing/advertising message (ФЗ-38 ст.18) is dispatched to a subject unless a `consents` row
exists with `kind='marketing'`, non-null `granted_at`, `withdrawn_at IS NULL`, and a stored
`text_version`. (Blocks send if the §2 consent log is absent → forces the seam.)

**P-4 (future, distribution) — separate ст.10.1 consent before contact distribution.** Assert:
contact-reveal exposes a phone/telegram only if a `consents` row `kind='distribution'`
(ст.10.1) is granted; `contact_prefs` alone is insufficient. Also assert `contact_prefs` default is
all-OFF (§2a).

**P-5 (today→future) — PII residency & at-rest.** Assert every store holding RF-citizen PII
(`users.{full_name,email,contact_*}`, `organizations.{inn,kpp,...}`, notification content, provider
docs, precise geo) is RF-region-resident (ADR-0017) and PII columns are encrypted/blind-indexed per
ADR-0012/0019. CI/deploy guardrail: fail if any replica/backup/DR target region ∉ RF.

**P-6 (future, Rx) — Rx toggle OFF.** Assert the goods/pharmacy `feature_toggle` for Rx/prescription
medicines is OFF, and any regulated-publish path is server-side hard-gated on a verified pharmacy
licence (ADR-0016 T3) — 61-ФЗ / Пост.697.

**P-7 (future, fiscal) — 54-ФЗ receipt on own paid service.** Assert: any boost/premium/own B2C
charge emits an ОФД fiscal receipt regardless of the `payments` toggle (checklist C1).

**P-8 (future, provider) — regulated-publish requires verification.** Assert: a regulated-category
Offering cannot reach PUBLISHED unless a tamper-proof `verification` record at the required tier
(ADR-0016 T0–T3) exists server-side (never client-asserted).

**P-9 (today) — RF breach clock in runbook.** Assert the incident-response runbook encodes the
two-stage РКН clock **24h (fact) + 72h (investigation)** (ст.21 ч.3.1), not a single 72h.

**P-10 (future, species) — CITES report path.** Assert a prohibited-species / CITES / ст.258.1
report+rejection reason exists in the reason enums and moderation_reasons seed (§3g).

---

## Summary
- **Wave-fix (aec19d1): VERIFIED CORRECT** — lawful basis ст.6 ч.1 п.5, breach 24h+72h (ст.21 ч.3.1),
  РКН notice ст.22, residency ст.18 ч.5→ADR-0017; no stale GDPR/legitimate-interest/single-72h text.
- **Go-live artifacts: BLOCKER resolved to DRAFT** (0→6 files), honestly labelled, not falsely
  "published"; owner still owes entity-identity + counsel review + publication (a launch gate).
- **Top seam to reserve now: the consent-record MODEL** (§2) — schema has only `contact_prefs Json`,
  no versioned append-only consent log for ФЗ-38 marketing / ст.10.1 distribution proof; plus
  `contact_prefs` defaults to pre-consented distribution (§2a).
- **Other reserved seams recorded:** reviews-removal ст.152 ГК (§3f, not reserved), CITES report
  reason (§3g, doc↔reality gap), 54-ФЗ/Rx/provider-verification (captured in docs/ADRs, guard on ship).
- **Probes: 10** (P-1..P-10; 4 assertable today, 6 guard future regulated tracks).

All findings above are **RECORD (non-blocking)** — durable knowledge for the regulated side, not a
stop on the current build.
