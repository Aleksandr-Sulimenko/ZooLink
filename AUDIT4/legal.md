# ZooLink HYPER³ Audit — Round-3 · Phase 2 · legal (RF-first compliance, forward-compat)

**Date:** 2026-07-08 · **Branch:** `backend` · **HEAD:** `0fcc182` · **Role:** legal specialist
**Method:** independent legal pass over the **fix-program surface** (consents ADR-0020, PII-at-rest
mig 0028, contact-reveal gate, erase/retention) + re-derivation of the standing axes, then diffed
against `AUDIT3/legal.md` and `AUDIT2/legal.md`. New strategic lens: **AI-as-operator** legal seams.

Finding format: `[severity][criterion][axis][state] file:line → problem → norm → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO · axis ∈ same|new|trash|strat ·
state ∈ NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED.

> **RECORD-ONLY POSTURE (owner directive, 2026-07-08).** Legal publish / РКН filing / secret-rotation
> / RF-zone confirmation are **DEFERRED to near-release**. Nothing below gates the current build.
> "go-live gate" = a gate the owner clears **before public launch**, not a stop now. Where a norm is
> uncertain I write **требует ручной проверки / confirm with retained counsel** and do not invent law.
> Dated 2026-07-08; RF law is interpreted and changes — re-verify редакция before reliance. Advisory
> only; final go/no-go and signatures are the owner's.

---

## 0. Headline — the fix-program closed both AUDIT3 CRITICALs

The two Round-3 CRITICALs (consent-record model absent; live pre-consented ст.10.1 distribution on a
`show_phone:true` default) are **FIXED-VERIFIED** in code. The `consents` model (ADR-0020, mig 0029)
is a genuine, append-only, versioned ст.9 ч.1 proof store; contact-reveal is now hard-gated on a
`CONTACT_DISTRIBUTION` consent **AND** per-channel visibility; the pre-checked default is flipped
all-OFF at all three sites. This is the single biggest compliance-posture improvement since audit
inception. Residuals are now MINOR (erase-withdrawal row; policy-version→published-text pinning).

The **strategic** picture also sharpened: the RF **ст.16 ФЗ-152** norm (solely-automated
decision-making) is the concrete legal spine for the AI-as-operator North Star (ADR-0006) — the
human-override machinery already built (mig 0016/0011) is exactly what ст.16 demands; the missing
piece is the consumer-facing disclosure/right-to-object surface (checklist B5).

---

## 1. FIXED-VERIFIED — consent-record MODEL now exists (AUDIT3 §1 CRITICAL closed)

`[INFO][marketing][new][FIXED-VERIFIED] database_schema.sql:1054 (consents) + backend/src/modules/identity/consent.service.ts:43 / ст.9 ч.1, ст.9 ч.2 ФЗ-152 → AUDIT3 §1 / AUDIT2 §2 (CRITICAL: no versioned append-only consent log) is RESOLVED. mig 0029 adds consents(user_id, consent_type CHECK{CONTACT_DISTRIBUTION live; MARKETING/ANALYTICS_PROFILING/NONESSENTIAL_COOKIES reserved}, granted BOOL, policy_version, source, actor_id+actor_principal_type, created_at), append-only via trg_consents_immutable (BEFORE UPDATE/DELETE block), current=latest row (idx_consents_current). ConsentService.record() appends; withdrawal = a new granted=false row (ст.9 ч.2 "withdrawal as easy as grant"); text version stored (ст.9 ч.1 proof: version+timestamp+action). Subject (user_id) kept distinct from acting principal (actor_id + AGENT/HUMAN) → ADR-0006-ready. Assessment: satisfies ст.9 ч.1/ч.2 in FORM. Residual: policy_version pinning (§4). RECORD.`

## 2. FIXED-VERIFIED — contact-reveal gate + default-OFF (AUDIT3 §2 CRITICAL closed)

`[INFO][pii][new][FIXED-VERIFIED] backend/src/modules/listing/listing.service.ts:554 + profile.service.ts:86 + admin-user.service.ts:36 + lib/scheduler/retention.service.ts:14 / ст.10.1 ФЗ-152 → AUDIT3 §2 (CRITICAL: SEV-CHG↑, reveal distributed phone on a pre-checked default) is RESOLVED at all three sites AUDIT3 named. (a) revealContact now computes channels FIRST and requires consent.currentlyGranted(seller, 'CONTACT_DISTRIBUTION') AND prefs.show_phone — no consent ⇒ NO_CHANNELS, no quota burned; ст.10.1 separate-affirmative-consent basis is now real, not contact_prefs alone. (b) DB default flipped to all-OFF (mig 0029); the two code mirrors (admin-user.service.ts:36, retention.service.ts:14) are both {show_phone:false, show_telegram:false} → erase/retention reset no longer re-enables distribution (AUDIT3's three-site defect gone). (c) profile.service records the CONTACT_DISTRIBUTION grant/withdrawal in the SAME tx as the show_* write, only on an actual state-flip (no duplicate rows). Assessment: lawful basis for the LIVE distribution path is now solid. RECORD.`

## 3. NEW — eraseUser writes no CONTACT_DISTRIBUTION withdrawal row (ст.9 ч.2 hygiene)

`[MINOR][pii][new][NEW] backend/src/modules/identity/admin-user.service.ts:214-250 (eraseUser) + lib/scheduler/retention.service.ts (eraseDeactivatedPastGrace) / ст.9 ч.2, ст.16 ФЗ-152 → eraseUser sets contact_prefs=all-OFF and contact_phone=null but does NOT append a granted=false CONTACT_DISTRIBUTION row. Because consents is immutable/append-only, the latest row survives erasure, so consent.currentlyGranted() would still return true for an anonymised subject — the "current consent" state is stale. NOT an active-distribution risk (contact_prefs all-OFF + contact_phone null ⇒ NO_CHANNELS regardless), so severity is MINOR. Norm nuance: the consents ROWS are lawful-basis accountability records, not subject PII (no email/phone; user_id UUID is retained by anonymise-in-place) — RETAINING them is correct (proof of past basis), NOT a right-to-erasure violation. The fix is to APPEND a withdrawal, not delete: in the erase tx, consent.record({granted:false, source:'ERASURE', actorPrincipalType}) for any currently-granted consent type → makes currentlyGranted() honest post-erase + records the ст.9 ч.2 withdrawal event. This matches the profile.service pattern (all-channels-off → withdrawal row). RECORD.`

## 4. NEW — policy_version is a bare constant with no pinned published text (ст.9 ч.1 proof depth)

`[MINOR][marketing][new][NEW] backend/src/modules/identity/consent.service.ts:17 (CONSENT_POLICY_VERSION='1.0') + database_schema.sql:1057 (policy_version VARCHAR, no FK) / ст.9 ч.1 ФЗ-152 → ADR-0020 (accepted) deliberately stores policy_version as a plain string, no policy-registry FK. The ст.9 ч.1 proof is only as strong as the mapping from the stored version to the ACTUAL immutable text the subject saw. Today the consent text lives in a DRAFT doc (docs/legal/consent-personal-data.md, STATUS: DRAFT) that can change without bumping the constant → a stored '1.0' could point to text that has since silently changed, hollowing the proof. Assessment: acceptable FORM for MVP (ADR-0020 chose this), but a real proof-store precondition before go-live. Fix (go-live gate, RECORD-ONLY now): (a) freeze consent text v1.0 as a published, immutable artifact at launch; (b) process discipline — any text change bumps the constant BEFORE it ships; (c) later, a policy_versions table with the frozen text hash (form-now seam if cheap). Confirm mapping-adequacy with retained counsel. RECORD (go-live gate).`

## 5. NEW (strength) — notification consumer is transactional-only (ФЗ-38 correct)

`[INFO][marketing][new][NEW] backend/src/modules/notification/*NotificationConsumer* (mig 0030) / ФЗ-38 ст.18, ст.9 ФЗ-152 → the first outbox consumer sends transfer-lifecycle notifications transactionally, ignoring notification_prefs (correct: transactional service messages ≠ реклама, no prior opt-in needed under ФЗ-38 ст.18). No marketing/advertising send path exists; the MARKETING consent_type is reserved but unwired. Assessment: lawful. [PERSP] the moment a MARKETING send is added, it MUST branch on a MARKETING consents row (granted, non-withdrawn, version) + carry an unsubscribe in EVERY message (ФЗ-38 ст.18 ч.1) + double-opt-in — the consents model already reserves the type, so this seam is cheap. RECORD.`

## 6. CONFIRMED — PII-at-rest crypto adequate in FORM; СКЗИ residual open (AUDIT3 §5)

`[INFO][pii][same][CONFIRMED] mig 0028 + backend/src/lib/crypto/crypto.service.ts + listing.service.ts (reveal decrypt) / ст.19 ФЗ-152, приказ ФСТЭК России №21 → email + contact_phone are AES-256-GCM at rest (random IV+tag, key from PII_DATA_KEY min-32 no-default) + email HMAC blind-indexed; contact_phone decrypted ONLY inside the consent-gated reveal (§2). Adequate FORM for ст.19 организационно-технические меры. Residual (unchanged): whether AES-256-GCM via a JS lib counts as a "certified СКЗИ" under приказ ФСТЭК №21 for this data class is a tracked legal investigation — most marketplace PII is not ГИС/gov-data so certified СКЗИ is likely NOT mandatory, but требует ручной проверки / confirm with retained counsel + verify редакция №21. Strength, not a gap. RECORD.`

## 7. CONFIRMED — go-live legal artifacts still DRAFT (AUDIT3 §3), RECORD-ONLY

`[MAJOR][go-live][same][CONFIRMED] docs/legal/{public-offer,terms-of-service,privacy-policy,consent-personal-data,launch-compliance-checklist,README}.md / ст.435–438 ГК; ст.18.1 ч.2 п.2 ФЗ-152 → all six + RU mirror STATUS: DRAFT; operator-identity/DPO/processor placeholders unfilled; no counsel review; not published/footer-linked → until published & accepted the ст.6 ч.1 п.5 (contract/оферта) basis is UNGROUNDED. Owner actions (deferred to near-release): register operator entity (B1), fill placeholders, counsel-review, publish+footer-link. RECORD-ONLY (go-live gate A1) — owner-deferred.`

## 8. CONFIRMED — RF data-residency ст.18 ч.5; ADR-0017 Proposed, guardrail unbuilt (AUDIT3 §4)

`[MAJOR][pii][same][CONFIRMED] docs/04-decisions/0017-rf-data-residency.md (Status: Proposed) + deployment_specification.md / ст.18 ч.5 ФЗ-152 → residency requirement captured; ADR still Proposed; deploy spec still carries unconstrained cross-region language; the CI/deploy "fail-on-non-RF-region" guardrail (ADR-0017 §8) NOT built. RF-zone confirmation is owner-DEFERRED. [PERSP] region-pinning + guardrail are FREE now and costly after RF-citizen PII lands — cheapest to reserve before first prod data, even while the topology decision waits. Primary ФЗ-152 go-live floor. RECORD-ONLY (go-live BLOCKER A3) — owner-deferred.`

## 9. CONFIRMED — 54-ФЗ ККТ on own paid services; no billing module (AUDIT3 §6)

`[INFO][fiscal][same][CONFIRMED] docs/legal/launch-compliance-checklist.md (C1) + lib/providers/payment/stub-payment.adapter.ts / 54-ФЗ; ЗоЗПП → boost/premium are the Operator's OWN B2C services ⇒ ККТ/фискальный чек applies REGARDLESS of feature_toggles.payments. Only a stub adapter exists; no billing module. When any own paid service ships: wire ОФД fiscal-receipt issuance, pick marketplace-vs-payment-agent model, apply ЗоЗПП to own services; if funds are ever held ⇒ 115-ФЗ/161-ФЗ (C2). Seam reserved. RECORD (conditional gate C1).`

## 10. CONFIRMED — CITES/prohibited-species report enum still missing (AUDIT3 §7)

`[MINOR][species][same][CONFIRMED] backend/src/modules/moderation/dto/content-report.dto.ts:20 (REPORT_REASONS = SPAM|ABUSE|FRAUD|INAPPROPRIATE|OTHER) / CITES; ст.258.1 УК РФ; 498-ФЗ → unchanged: the user-facing content-report enum still has no prohibited-species/CITES/Красная-книга reason, so a user cannot flag a CITES / ст.258.1 listing under a specific reason. (The moderation_reasons REJECTION seed DOES carry prohibited_species — AUDIT3 §7 REFUTED the "unseeded" claim; that stays refuted.) Fix: add a CITES/prohibited-species content-report reason + publish the prohibited-species policy in the Rules (B2). RECORD (non-blocking).`

## 11. CONFIRMED — informational-intermediary shield + reviews ст.152 (AUDIT3 §9)

`[INFO][intermediary][same][CONFIRMED] docs/04-decisions/0016-provider-model.md + future-features.md:213 / ст.1253.1 ГК; ФЗ-149 ст.10; ЗоЗПП «владелец агрегатора»; ст.152 ГК → three-regime immunity model sound; shield holds only while a working takedown channel (B4, still ☐/placeholder) is published and the operator stays a neutral venue. Reviews/Ratings still deferred with no ст.152 removal/right-of-reply procedure reserved (defamation exposure is distinct from the ст.1253.1 content shield). Fixes: publish takedown/abuse channel before launch (B4); when reviews ship, reserve review-removal + right-of-reply + author-identity retention. RECORD (go-live gate B4; forward-compat seam).`

## 12. CONFIRMED — privacy-policy lawful-basis cell wording (AUDIT3 §10)

`[MINOR][pii][same][CONFIRMED] docs/legal/privacy-policy.md (security/fraud/audit cell) / ст.6 ч.1 п.2 vs п.5 ФЗ-152 → cell mixes ст.6 ч.1 п.2 (processing required by law) with a GDPR-flavoured "legitimate operation" phrase; п.2 is narrow — fraud-prevention is better on п.5 (contract) or a specific legal duty. Tighten to the precise basis; require ручной проверки. RECORD (non-blocking).`

---

## 13. STRATEGIC [NS] — the AI-as-operator legal spine is ст.16 ФЗ-152

`[MAJOR][ai-operator][strat][NEW|NS] docs/04-decisions/0006-ai-agents-operate-platform.md + migrations 0016/0011/0017/0034 + checklist B5 + terms-of-service.md:49 (placeholder appeal channel) / ст.16 ФЗ-152; ст.1253.1 ГК; ЗоЗПП → The North Star (agents operate moderation→admin→business) has a concrete RF norm, sharper than AUDIT3 §8 framed it: ст.16 ФЗ-152 governs decisions producing legal (or otherwise rights-affecting) consequences taken on the basis of SOLELY automated processing of personal data. It (a) forbids such decisions UNLESS there is written consent of the subject or a federal-law basis, (b) obliges the operator to EXPLAIN the decision procedure, and (c) grants the subject a RIGHT TO OBJECT + human reconsideration. An AI-agent moderator auto-rejecting a listing or auto-suspending an account is squarely in scope. The good news: the human-override machinery ст.16 demands is ALREADY built — actor_principal_type HUMAN|AGENT + is_human_override + supersedes_decision_id on moderation_decisions (mig 0016), append-only audit, agent-actor identity (service_credentials mig 0017, user_roles agent-actor mig 0034). The MISSING legal seams are the consumer-facing surfaces: the ст.16 explanation + right-to-object + automated-decision disclosure (B5, still ☐) and the ToS appeal clause (placeholder). CRITICAL liability framing: an AI agent is NOT a legal person in RF (no e-personhood); the registered OPERATOR (ИП/ООО) is the legal actor and SOLE bearer of liability for every agent act — actor_principal_type=AGENT records provenance, it does NOT shift liability off the operator, and the ст.22.1 ответственный за обработку ПДн stays a named HUMAN accountable for agent-driven processing. No comprehensive RF AI-liability statute is in force as of this date (ФЗ-258 experimental legal regimes + draft concepts only — требует ручной проверки / monitor). RECORD-ONLY; shapes agent-runnability scorecard.`

### [PERSP] — legal/compliance seams cheaper to reserve now than to retrofit at monetization/scale
- **ст.16 automated-decision consent seam.** If a domain's agent decisions need the ст.16 "written
  consent" basis, a reserved `consent_type` (e.g. `AUTOMATED_DECISION`) in the existing consents
  CHECK is a near-free form-now seam (the model + immutability already exist) — far cheaper than
  retrofitting a consent basis over a live user base at monetization. RECORD.
- **ст.16 explanation + right-to-object ToS clause + disclosure surface (B5).** Reserve the clause
  and the disclosure component now (form); retrofitting a lawful basis + appeal path onto users who
  already received agent decisions is the anti-rewrite scenario ADR-0012/0019 warn against.
- **Audit-retention floor.** The append-only audit_log with actor_principal_type is the accountability
  proof for agent decisions; it must be retained ≥ the liability/limitation period and NEVER pruned
  below that floor (the analytics-guardrail on the outbox already points this way). Cheap to pin now.

### AI-as-operator legal-seam checklist (what must be TRUE legally before an agent lawfully operates a domain)
RECORD-ONLY — this gates lawful *agent operation*, not the current build.

1. ☐ **Operator entity registered** (ИП/ООО) = the legal principal bearing liability for ALL agent
   acts; the agent is its instrument, not a separate liable person. (checklist B1)
2. ☐ **ст.22.1 ответственный за обработку ПДн** = a named HUMAN, accountable for agent-driven PII
   processing; published in the privacy policy.
3. ☐ **ст.16 ФЗ-152 basis** for any solely-automated agent decision affecting a subject's rights:
   written consent OR federal-law basis (reserve `AUTOMATED_DECISION` consent_type seam).
4. ☐ **ст.16 explanation** of the decision procedure published (how the agent decides, in plain terms).
5. ☐ **ст.16 right-to-object + human reconsideration** path that actually overturns — the DB
   machinery (is_human_override/supersedes_decision_id) wired to a REACHABLE human workflow, not just
   a column. (partially built — machinery ✅, workflow/surface ☐)
6. ☐ **Automated-decision DISCLOSURE surface (B5)** live: "this decision may be automated; appeal to
   a human via [channel]"; ToS appeal-channel placeholder filled (terms-of-service.md:49).
7. ☐ **ЗоЗПП consumer reachability** — a human is reachable for consumer-facing agent decisions
   (refunds/disputes once payments live); no "the bot decided, end of story".
8. ☐ **Intermediary neutrality preserved (ст.1253.1 ГК)** — agent moderation stays "lawful
   moderation," not editorial curation that forfeits the informational-intermediary shield.
9. ✅/☐ **Accountability audit** — append-only actor_principal_type + human-override recorded (✅);
   retention ≥ liability period, never pruned below floor (☐ pin the floor).
10. ☐ **AI-regulation horizon** monitored — no comprehensive RF AI-liability law in force; verify
    before scale (требует ручной проверки / confirm with retained counsel).

---

## Diff vs AUDIT3/legal.md

| # | Round-3 (this) finding | vs AUDIT3 | Δ |
|---|---|---|---|
| 1 | Consent-record MODEL exists (ADR-0020) | §1 CRITICAL | **FIXED-VERIFIED** |
| 2 | Contact-reveal gated + default-OFF (3 sites) | §2 CRITICAL | **FIXED-VERIFIED** |
| 3 | eraseUser no withdrawal row | — | **NEW** (MINOR) |
| 4 | policy_version → no pinned published text | — | **NEW** (MINOR) |
| 5 | Notification consumer transactional-only | — | **NEW** (strength) |
| 6 | PII-at-rest crypto; СКЗИ residual | §5 | **CONFIRMED** |
| 7 | Go-live artifacts DRAFT | §3 | **CONFIRMED** (owner-deferred) |
| 8 | RF residency, ADR Proposed, guardrail unbuilt | §4 | **CONFIRMED** (owner-deferred) |
| 9 | 54-ФЗ ККТ own services | §6 | **CONFIRMED** |
| 10 | CITES report enum missing | §7 | **CONFIRMED** |
| 11 | Intermediary shield + reviews ст.152 | §9 | **CONFIRMED** |
| 12 | privacy-policy basis wording | §10 | **CONFIRMED** |
| 13 | AI-as-operator = ст.16 ФЗ-152 spine | §8 (framed loosely) | **NEW|NS** (sharpened to the norm) |

**Counters:** FIXED-VERIFIED 2 (both AUDIT3 CRITICALs) · NEW 4 (2 MINOR + 1 strength + 1 NS-strategic) ·
CONFIRMED 7 · REFUTED 0 · SEV-CHG 0.

---

## Go-live legal gates (current, ranked) — ALL RECORD-ONLY / owner-deferred to near-release

1. **A3 — RF data-residency (ст.18 ч.5).** ADR-0017 Proposed; guardrail unbuilt. [PERSP] pin regions
   before first prod PII. Primary ФЗ-152 floor. (§8)
2. **A1 — Publish offer/ToS/privacy (ст.435–438 ГК; ст.18.1 ч.2 п.2 ФЗ-152).** All DRAFT; basis
   ungrounded until published+accepted. (§7)
3. **A2 — РКН processing notification (ст.22 ФЗ-152)** before processing begins. (owner)
4. **A4 — Designate ответственный за обработку ПДн (ст.22.1)**; publish in policy. (owner) — also
   the named human accountable for agent-driven processing (§13).
5. **Consent-proof depth — pin policy_version to frozen published text (ст.9 ч.1).** (§4)
6. **B5 — automated-decision disclosure + ст.16 right-to-object surface + ToS appeal channel.** (§13)
7. **B4 — takedown/abuse channel published (ст.1253.1; ФЗ-149 ст.10).** (§11)

**Conditional (only if a toggle/feature flips ON):** 54-ФЗ ККТ on any own paid service incl.
boost/premium regardless of payments toggle (§9, C1); 115-ФЗ if funds held (C2); ФЗ-38 marketing
opt-in via the MARKETING consent row + per-message unsubscribe (§5, C3); ст.12 cross-border review.

**Cheap now (do-not-forget):** eraseUser withdrawal row (§3), CITES report reason (§10),
`AUTOMATED_DECISION` consent_type seam (§13 PERSP), audit-retention floor pin (§13 PERSP).

All findings above are **RECORD-ONLY** for the current build — durable knowledge + launch gates, not
a stop on development. Advisory; the owner decides and signs; retained counsel reviews before launch.
