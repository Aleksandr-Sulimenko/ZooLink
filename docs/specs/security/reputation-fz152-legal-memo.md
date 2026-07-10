# Legal memo — ФЗ-152 basis for the reputation-subsystem erasure model (gates `feature_toggles.reputation_reviews`)

> **STATUS: DRAFT legal analysis — advisory, not a substitute for retained counsel.** This memo is
> the ZooLink `legal` role's reasoned analysis of the ФЗ-152 questions that gate flipping
> `feature_toggles.reputation_reviews` on (ADR-0039 Open Q1; spec 18 §13 fork 8). It **surfaces,
> drafts and recommends; the owner decides and a licensed attorney should confirm** the unsettled
> core (Q1) before the toggle is flipped. Every cited norm is a claim about the law **as of the
> analysis date below** — **re-verify each article is still in force and unchanged before relying on
> it** (ФЗ-152 has been amended repeatedly, incl. the ст.10.1 dissemination regime and the 2022–2024
> обезличивание / breach-notification packages).
>
> **Jurisdiction:** Russian Federation. **Analysis date:** 2026-07-10. **Repo state:** branch
> `backend`, HEAD `950a7c9`; migrations `0039_confirmed_sales` + `0040_reputation_storage` (dormant).
> **EN canon; RU 1:1 mirror at `docsRU/specs/security/reputation-fz152-legal-memo.md` (operative).**

---

## 0. Question & bottom-line verdict

**The gating question (ADR-0039 §4 / Open Q1):** on `eraseUser` of a review **author** (or on the
author's withdrawal of consent / demand to destroy their PII), is it lawful under ФЗ-152 to **keep
the author's 1–5 star** in the rated subject's reputation aggregate, while pseudonymising authorship
(`reviewer_user_id → NULL`) and dropping the free-text `body`?

**Verdict: LAWFUL WITH CONDITIONS (правомерно при условиях).** The retained star is defensible **not**
as "retaining the author's personal data under a lawful basis" (that footing is weak — ФЗ-152 has no
GDPR-style balancing "legitimate interest", and ст.6 ч.1 п.7 is read restrictively), **but** as
**обезличивание / de-identification (ст.3 п.9, ст.5 ч.7, ст.7)**: once the author link is genuinely
severed and the identifying free-text is removed, a bare integer 1–5 attached to the *subject's*
aggregate **ceases to be the author's personal data**, so the ст.14 / ст.21 destruction right — which
reaches only **personal data** — no longer applies to it. This is the structurally sound path the
schema already supports (`reviewer_user_id ON DELETE SET NULL`, `confirmed_sales` party FKs
`ON DELETE SET NULL`, `body` drop on erase). **It is conditional** on (a) the de-identification being
**genuine** (no residual re-identification vector), (b) the free-text `body` actually being dropped on
erasure of **either** party, and (c) a **REVIEW_PUBLICATION** consent + a plain-language disclosure of
this retention captured at submission. The core de-identification theory rests on **unsettled** РКН /
court practice on *when a datum is truly обезличен vs. re-identifiable* — flagged throughout and
carried to counsel.

The five sub-questions and their answers:

| # | Question | Answer (confidence) |
|---|---|---|
| 1 | Keep the star after the author's withdrawal/erasure? | **Lawful-with-conditions** via обезличивание, **not** via "legitimate interest" (medium-high; the de-id/re-id line is unsettled — counsel-gated) |
| 2 | Can the rated subject compel deletion of a negative star? | **No** via ФЗ-152 (a star is an *value judgment*, not *inaccurate personal data*); dispute→moderation is the compliant accuracy mechanism; ст.152 ГК reaches only false **facts** in `body` (medium-high) |
| 3 | Is "drop `body` on author erasure" sufficient? | **Confirmed and necessary** — and it must **also** run on **subject** erasure (gap: currently no auto-drop of `body`) (high) |
| 4 | Is a separate REVIEW_PUBLICATION consent required? | **Yes — capture it at submission** (ст.9 informed + ст.10.1 dissemination form); with a disclosure of the de-id retention (medium-high) |
| 5 | GO/NO-GO before the toggle | Numbered checklist in §6 — publication consent, оферта/policy text, erase-path `body` drop, moderation live, РКН notice amendment, counsel sign-off on Q1 |

---

## 1. Q1 — Basis for retaining the star (the core)

**Legal question.** After a review author withdraws consent / demands destruction of their ПДн
(ст.9 ч.2, ст.14, ст.21 ч.5), may the operator keep their rating (1–5) in the subject's aggregate?

### 1.1 Candidate bases assessed honestly

**(a) ст.9 ч.2 — limits of consent withdrawal.** Withdrawal does **not** end processing where the
operator has an **independent** lawful basis (ст.6 ч.1 п.2–11, or ст.10/11 grounds). So withdrawal
alone is not dispositive — but it only helps if some **other** basis actually covers *the author's
star*. That is where it gets thin (below). Withdrawal *does* end the **consent** basis (publication).

**(b) ст.6 ч.1 п.5 — performance of the contract to which the subject is a party.** The author is a
party to the user agreement (оферта). But retaining *the author's own star* is not "necessary to
perform the contract *with the author*" — the author gains nothing from their star persisting after
they leave. **Weak basis for the author's data.** (It is, however, a reasonable basis for the
*subject-facing* aggregate — see Q2.)

**(c) ст.6 ч.1 п.7 — rights/legitimate interests of the operator or third parties / socially
significant aims, provided the subject's rights and freedoms are not violated.** This is the closest
analogue to GDPR Art.6(1)(f), and it **does exist** in ФЗ-152 — but **honestly, it is materially
weaker**: it is not a general balancing test, РКН reads it restrictively, and the "not violating the
subject's rights" proviso is exactly what a subject who *demanded destruction* would contest.
**Do not lean the whole retention on п.7** — treat it only as a secondary prop for the *subject-side*
aggregate (Q2), never as the primary basis for holding identifiable *author* data against an erasure
demand.

**(d) обезличивание (ст.3 п.9, ст.5 ч.7, ст.7) instead of destruction (ст.21 ч.5) — THE ANSWER.**
ст.3 п.1 defines personal data as information *relating to a directly or indirectly identifiable
natural person*. ст.3 п.9 defines обезличивание as actions after which *it becomes impossible,
without additional information, to attribute the data to a specific subject*. The insight: once
(i) `reviewer_user_id` is set NULL, (ii) the `confirmed_sales` party FK linking the author to the sale
is set NULL (both are already `ON DELETE SET NULL`), and (iii) the identifying free-text `body` is
dropped, the **bare star is no longer "relating to a determinable" author** — it is data **about the
subject**, dissociated from its author. It has been **de-identified with respect to the author**.
ст.21 ч.5 permits обезличивание as an alternative to destruction where retention is needed; and
де-identified data falls **outside the ст.14/ст.21 destruction right**, because that right reaches
*personal data*, and a datum that no longer relates to the person is not their personal data.

**Conclusion:** the lawful footing is **"after pseudonymisation + body-drop, the star is no longer the
author's personal data at all"** — not "we keep the author's data under a basis." This is the
structurally strongest position and the one the schema already realises.

### 1.2 The condition that makes or breaks it — genuineness of de-identification

De-identification is only real if the star **cannot be re-attributed to the author from the
operator's own retained data without additional information** (ст.3 п.9). Assessment of the residual
re-identification vector in the built structure:

- `reviews.reviewer_user_id → NULL` on author erase — ✔ direct link severed.
- `reviews.confirmed_sale_id` still points to a `confirmed_sales` row; **but** on author erase that
  sale's `buyer_user_id`/`seller_user_id` party FK is **also `ON DELETE SET NULL`** (migration 0039,
  verified) — ✔ so the operator cannot walk review → sale → author.
- **Residual (flag, medium):** a review carries `direction` (`BUYER_ON_SELLER`) and its sale still
  names the **live** counterparty (the subject, as `seller_user_id`). "The buyer of sale S whose
  seller is X" is a **narrow** descriptor; the operator holds **no** direct identifier for that buyer
  after the nulls, but a determined correlation with *external* information (the subject's own memory,
  logs) could in principle narrow it. Under ст.3 п.9 the test is re-identifiability **without
  additional information** — on the operator's retained data alone, after the nulls + body-drop, the
  author is not determinable. **Position: defensible; not risk-free.** РКН's обезличивание
  methodology and courts have **not** settled a bright-line "how narrow is too narrow" test — this is
  the unsettled core. Mitigation options for counsel: (i) accept as genuinely обезличен (recommended,
  with the disclosure in §4); (ii) if challenged on a *specific* star, drop that star (a per-datum
  fallback) rather than defend the whole aggregate.

**Norms:** ст.3 п.1, п.9; ст.5 ч.7 (data must not be excessive to the purpose — favours keeping the
minimal star, dropping the rich text); ст.7 (no disclosure/dissemination of PD without consent —
satisfied once the star is de-identified); ст.9 ч.2; ст.14; ст.21 ч.5. **Confidence: medium-high the
approach is defensible; the de-id/re-id line itself is UNSETTLED (counsel-gated).**

---

## 2. Q2 — The rated subject's rights over a negative star (dual-subject)

**Legal question.** The star is simultaneously data **about the subject**. Can the rated seller
compel deletion of a negative rating under ст.14 / ст.21, or via defamation (ст.152 ГК)?

### 2.1 Under ФЗ-152 — generally no

- The ст.14 ч.1 / ст.21 ч.1 correction-and-destruction right is triggered by data that is
  **inaccurate, incomplete, outdated, unlawfully obtained, or unnecessary to the purpose**. A genuine
  1–5 rating from a **CONFIRMED** transaction is a **subjective value judgment**, not a *factual*
  personal-data item about the subject. The ст.5 ч.6 accuracy principle governs **factual** personal
  data (name, contacts, status) — it does **not** make a third party's honest opinion "inaccurate
  personal data" the subject can strike. **The subject cannot use ФЗ-152 accuracy to delete a
  truthful, transaction-backed opinion.**
- The operator's lawful basis to process/publish data **about the subject** in the aggregate:
  **ст.6 ч.1 п.7** (operator's/third parties' legitimate interest in a trust-safety signal + socially
  significant aim of consumer protection, subject's rights preserved by the dispute mechanism) **plus**
  the subject's own acceptance of the platform Rules/оферта (which must state that a two-sided,
  proof-of-transaction reputation system operates). This is a defensible pairing; п.7 here is on
  firmer ground than in Q1 because the subject's rights are actively preserved by §2.2.

### 2.2 The compliant "accuracy / objection" mechanism = dispute → moderation (ADR-0040 §2)

The subject's ст.14/ст.21 interest in accuracy is **honoured procedurally**, not by deletion-on-demand:
the subject can **dispute** a review, routing it to the existing moderation spine (ADR-0040 §2 —
a `content_report` subtype resolved by an append-only `moderation_decisions` row, human-override
intact). Position this in the оферта/policy as the operator's ст.5 ч.6 accuracy + ст.14 objection
channel. If an **agent** ever moderates, **ст.16** (no solely-automated decision producing legal
effects without safeguards) requires the human-override + appeal already designed (ADR-0011 §3) and
its disclosure (checklist B5).

### 2.3 Where real exposure lives — ст.152 ГК on the free-text `body`

- **ст.152 ГК РФ** (protection of honour, dignity, business reputation) reaches **untrue statements of
  fact** (порочащие сведения, не соответствующие действительности) — **not** value judgments. Per
  **Пленум ВС РФ №3 от 24.02.2005 (п.9)**, оценочные суждения / opinions are **not** checkable against
  "truth" and are not actionable under ст.152. **So the star is near-unassailable; the `body` free
  text is where liability sits** — a false factual claim ("продал больное животное и украл предоплату")
  can be actionable if untrue.
- **Operator's shield:** as an **информационный посредник (ГК ст.1253.1)** for user-authored review
  `body`, the operator is shielded if it stays a neutral venue with a **working takedown channel**
  (launch checklist B4) and acts on notice. This is why review `body` **must be moderated before
  publication** (moderation_status on `reviews`) and disputes must reach a human — the shield and the
  ст.152 mitigation both depend on it being **live at launch**.

**Norms:** ст.5 ч.6, ст.6 ч.1 п.7, ст.14 ч.1, ст.16, ст.21 ч.1 ФЗ-152; ст.152 ГК РФ + Пленум ВС РФ
№3/2005; ст.1253.1 ГК РФ. **Confidence: medium-high.**

---

## 3. Q3 — Body policy (confirm / correct)

**Confirmed:** dropping/redacting the free-text `body` on author erasure is **correct and, for Q1,
necessary** — the prose is far more identifying than a star (writing style, deal specifics, possible
embedded third-party PII), and the Q1 обезличивание argument **only holds if the body is gone**. A
star can be de-identified; a paragraph of authored narrative generally cannot.

**Correction / addition — a real gap:** the body must **also** be dropped/redacted on erasure of the
**subject** (the rated person), and this is **not** currently structural. On subject `eraseUser`:
- `reputation_aggregates` is `ON DELETE CASCADE` on `subject_user_id` — ✔ the aggregate is removed.
- `reviews.subject_user_id → NULL` — ✔ link severed.
- **BUT** the `body` free-text (which is data **about the subject**, and may narrate/identify them)
  is **not auto-dropped**. Retaining free-text about an **erased** subject is an ст.21 ч.5 gap.
- **Requirement (→ backend-engineer / alpha-analyst):** the erasure path must **redact/NULL `reviews.body`
  on erasure of EITHER the author (`reviewer_user_id`) OR the subject (`subject_user_id`)**, and must
  **NOT** recompute the aggregate downward on **author** erasure (keep-the-star). The `ON DELETE SET
  NULL` FKs pseudonymise the *links*; an explicit application action must clear the *text*.

**Norms:** ст.5 ч.7, ст.21 ч.5 ФЗ-152. **Confidence: high.**

---

## 4. Q4 — REVIEW_PUBLICATION consent (required? text? timing?)

**Legal question.** The `consents` model already reserves `REVIEW_PUBLICATION` (migration 0040 §C).
Is a separate consent to publish a review legally required (ст.9, ст.10.1 analogy), what minimal text,
and when?

### 4.1 Required — yes, capture it at submission

A published review disseminates the **author's** personal data (their authored opinion, and any
displayed handle) to a defined/unlimited circle of platform users = **распространение**. Under
**ст.7** (no dissemination of PD without consent) and **ст.10.1** (a **separate**, specific consent is
required for personal data *permitted for dissemination*; **silence/inaction ≠ consent**; it may not
be bundled into another consent), the cleanest and safest footing is a **dedicated, unbundled,
logged REVIEW_PUBLICATION consent at the moment of review submission** — exactly mirroring the
contact-distribution consent (existing `docs/legal/consent-personal-data.md` Consent 1). Even where
the author is shown pseudonymously, capturing an explicit ст.9 (informed, specific, conscious)
consent removes the ambiguity and is cheap. **Do not** rely on "submitting the review = implied
consent" as the sole basis — ФЗ-152 formalism (esp. ст.10.1) prefers an explicit, separate act.

> ⚠ **This is the highest-likelihood repeat risk.** The live contact-reveal shipped distributing
> seller phones on a pre-checked default **with no ст.10.1 consent record** (legal memory:
> `zoolink-contact-reveal-live-consent-gap`; launch checklist A5). If reviews launch the same way,
> it is the **same violation**. The REVIEW_PUBLICATION consent must be **wired before** the toggle
> flips — not retrofitted.

### 4.2 Minimal consent text (ст.9 ч.4 elements — RU, draft)

Must carry: operator identity, purpose, list of data, actions/dissemination, term, withdrawal, **and**
the de-id-retention disclosure (so the consent is *informed* per ст.9 ч.1 and the star-retention in Q1
is transparent):

> «Я даю согласие Оператору на **обработку и распространение** среди Пользователей Платформы моего
> отзыва (оценка 1–5 и, при наличии, текст) о второй стороне подтверждённой сделки, с указанием моего
> отображаемого имени/псевдонима, с целью формирования двусторонней репутации и защиты Пользователей.
> Отзыв публикуется после модерации. Я вправе **отозвать** согласие в любой момент в настройках
> профиля так же легко, как я его дал; **при отзыве отзыв снимается с публикации, авторство
> обезличивается, а свободный текст удаляется.** Обобщённая **оценка (звезда) в обезличенном виде
> может сохраняться** в агрегированном рейтинге второй стороны, поскольку после обезличивания
> перестаёт относиться ко мне как к определяемому лицу. Согласие действует до его отзыва.»

- **Store** (append-only `consents`, ADR-0020): `consent_type='REVIEW_PUBLICATION'`, text version,
  timestamp, actor snapshot, source — the ст.9 ч.1 proof-of-consent.
- **Withdrawal** (ст.9 ч.2, as easy as grant): unpublish + pseudonymise + drop `body`; the de-id star
  survives (Q1) **because and only because** the text above disclosed it.

### 4.3 Subject side

The **subject** does **not** give a per-review ст.9 consent (their data-about is processed on
**ст.6 ч.1 п.7** + Rules acceptance, Q2). Instead, the оферта/Rules must **state** that accepting the
platform means being subject to the two-sided, proof-of-transaction reputation system, with the
dispute channel as the accuracy remedy. **Confidence: medium-high** (the ст.10.1 reach over
pseudonymous author display is the softest edge — counsel to confirm whether a masked handle still
triggers ст.10.1 or only ст.9).

---

## 5. What the structure already gets right / what to add

**Already correct (no change needed):**
- `reviews.reviewer_user_id ON DELETE SET NULL` — the pseudonymisation mechanism for Q1. ✔
- `confirmed_sales.buyer_user_id`/`seller_user_id ON DELETE SET NULL` — severs the review→sale→author
  re-identification path, making the Q1 de-id genuine. ✔ (verified, migration 0039)
- `reputation_aggregates` PK `(subject_user_id, market)` **`ON DELETE CASCADE`** on subject — subject
  erasure removes the aggregate. ✔
- append-only `reviews` + `trg_reviews_immutable` + monotonic `seq` — integrity/audit trail supporting
  ст.5 accuracy and non-repudiation of the record. ✔
- `rating_avg` GENERATED (recompute-only) — unforgeable/unpurchasable, supports "derived not asserted"
  and fork 7 (not a ФЗ-152 point per se, but forecloses a manipulated trust signal). ✔
- `consents.consent_type` reserves `REVIEW_PUBLICATION` — the consent-of-record seam. ✔
- `feature_toggles.reputation_reviews` OFF + explicit legal-gate on §4 behaviour — the gate is
  respected. ✔
- `reviews.moderation_status` + ADR-0040 §2 dispute path — the ст.5/ст.14/ст.152-ГК mitigation seam. ✔

**Must be ADDED before the toggle flips (requirements → alpha-analyst / backend-engineer):**
1. **Erase-path `body` drop on BOTH parties.** Redact/NULL `reviews.body` on erasure of `reviewer_user_id`
   **or** `subject_user_id`. Q1 (author) *and* Q3 (subject) depend on it. **No structural support today.**
2. **No downward recompute on author erasure.** The erase path must keep the star (aggregate unchanged
   on author erase); only subject erase removes the aggregate (already CASCADE). Make this explicit so
   a future recompute job doesn't silently "correct" the aggregate down.
3. **REVIEW_PUBLICATION consent capture** at submission (§4) — separate, unbundled, default-off,
   informed (incl. the de-id disclosure), logged in `consents`; `reviews.is_visible` must not flip
   without it.
4. **Re-identification check** on the de-identified star (§1.2) — confirm no retained operator-side
   vector re-attributes it; document the residual `direction`+live-counterparty caveat and the
   per-datum drop fallback.

---

## 6. GO / NO-GO activation checklist (Legal DoD before `reputation_reviews` = ON)

Ranked by severity × likelihood. ☐ not started · ◑ partial · ☑ done. Owner-actionable unless marked.

| # | Requirement | Norm | Owner / role | Sev×Lik | Status |
|---|---|---|---|---|---|
| G1 | **REVIEW_PUBLICATION consent wired** — separate, unbundled, default-off, informed (with the §4.2 de-id disclosure), logged in `consents`; `is_visible` gated on it. **Highest-likelihood repeat of the live A5/contact-reveal ст.10.1 gap.** | ст.7, ст.9, **ст.10.1** ФЗ-152 | owner + backend/frontend | **HIGH×HIGH** | ☐ |
| G2 | **Moderation of review `body` + dispute→moderation live at launch** (не after) — the ст.152-ГК defamation + информационный-посредник shield + ст.5 accuracy mechanism all depend on it. | ст.5 ч.6, ст.14 ФЗ-152; ст.152, **ст.1253.1** ГК | owner + moderation | **HIGH×MED** | ☐ |
| G3 | **Erasure path: drop `body` on author OR subject erase; keep-the-star / no downward recompute on author erase.** Structural gap today (§3, §5). | ст.5 ч.7, ст.21 ч.5 ФЗ-152 | backend-engineer + alpha-analyst | **HIGH×MED** | ☐ |
| G4 | **Counsel sign-off on the Q1 обезличивание-retention theory** (the unsettled de-id/re-id core) + confirm the per-datum drop fallback. Do **not** flip without it. | ст.3 п.9, ст.5 ч.7, ст.21 ч.5 ФЗ-152 | owner + external counsel | **HIGH×MED** | ☐ |
| G5 | **Privacy Policy updated** — add reviews as a processing **purpose** (dual-subject); state legal bases (author: ст.9/ст.10.1 consent; subject: ст.6 ч.1 п.7 + Rules); retention/erasure policy (de-id star kept, body dropped); the REVIEW_PUBLICATION consent. | ст.18.1, ст.10.1 ФЗ-152 | owner (finalise `docs/legal/privacy-policy.md`) | MED×HIGH | ☐ |
| G6 | **Оферта / Rules updated** — a "Репутация и отзывы" section: two-sided, proof-of-transaction, moderation/dispute, star = **value judgment** (не факт), double-blind, windows, erasure/де-identification, subject acknowledges reviewability (ст.6 ч.1 п.7 basis stated). | ст.435–438 ГК; ЗоЗПП (platform's own duties) | owner | MED×HIGH | ☐ |
| G7 | **РКН notification (ст.22) — assess amendment.** Reviews add a new processing **purpose** ("формирование рейтинга/репутации") and possibly a new data category; if the уведомление is already filed (checklist A2), file an **amendment** before processing reviews. | **ст.22** ФЗ-152 | owner | MED×MED | ☐ |
| G8 | **Localisation confirmed for reviews tables (ст.18 ч.5).** RF-citizen PII in `reviews`/`confirmed_sales`/`reputation_aggregates` must sit in the RF-resident primary DB. **Already covered by ADR-0017 (RF-only)** — confirm the new tables inherit the region-pin; **no new cross-border issue** (RF-only). | **ст.18 ч.5** ФЗ-152; ADR-0017 | devops (confirm) | LOW×LOW | ◑ |
| G9 | **ст.16 automated-decision disclosure** if/when an **agent** moderates reviews — human-override + appeal (ADR-0011 §3) + disclosure. Not blocking while moderation is human (ADR-0040 §3 keeps agent-authoring OFF; agent-moderation is separately gated). | **ст.16** ФЗ-152; ADR-0006/0011 | owner + product | LOW×LOW | ◑ |
| G10 | **Data-minimisation review of `body`** (ст.5 ч.7) — free-text invites third-party PII; moderation must screen; retention bounded. | ст.5 ч.7 ФЗ-152 | moderation + legal | LOW×MED | ☐ |

**Sign-off:** flipping `reputation_reviews` requires **G1–G4 DONE** and G5–G7 DONE-or-owner-risk-accepted
with a date. Final go/no-go and any signature are the **owner's** with counsel on G4; this memo is advisory.

---

## 7. Risk register (ranked severity × likelihood)

| ID | Risk | Sev × Lik | Norm | Mitigation |
|---|---|---|---|---|
| R1 | Reviews published **without** a REVIEW_PUBLICATION / ст.10.1 dissemination consent — direct repeat of the live contact-reveal gap | **HIGH × HIGH** | ст.7, ст.9, ст.10.1 | G1 — wire consent before flip; `is_visible` gated on it |
| R2 | Q1 **de-identification theory rejected** by РКН/court (star held re-identifiable) → unlawful retention after a destruction demand | **HIGH × MED** | ст.3 п.9, ст.21 ч.5 | G4 counsel sign-off; genuine de-id (both party FKs null + body drop); per-datum drop fallback |
| R3 | **ст.152 ГК** defamation / third-party PII in `body`; информационный-посредник shield lost if no takedown | **HIGH × MED** | ст.152, ст.1253.1 ГК | G2 — moderate `body` pre-publication + working dispute/takedown live at launch |
| R4 | `body` **not dropped on erasure** (esp. subject) — retained identifying/subject data after an erasure demand | MED × MED | ст.21 ч.5 | G3 — erase-path body drop on either party |
| R5 | **РКН notice not amended** for the new reputation purpose | MED × MED | ст.22 | G7 — file amendment before processing |
| R6 | Subject files an ФЗ-152 **accuracy complaint** over a negative star (low legal merit — value judgment — but support cost) | LOW × MED | ст.5 ч.6, ст.14 | G6 оферта states star = opinion; dispute→moderation channel (G2) |
| R7 | **ст.16** exposure if an agent moderates reviews without disclosure/human-override | LOW × LOW | ст.16 | G9 — disclosure + human-override (already designed, ADR-0011) |

---

## 8. Cross-references
- **ADRs:** 0039 §4 / Open Q1 (the gated decision), 0038 (confirmed_sales party FKs), 0040 §2/§3
  (dispute→moderation, agent-as-moderator not reviewer), 0011 §3 (human-override, ст.16), 0017
  (RF-only localisation), 0020 (consents model, ст.9), 0012/0019 (PII-at-rest).
- **Spec:** `docs/specs/18-reputation.md` §9 (ФЗ-152 dual-subject), §11 (trust/ethics), §13 fork 8.
- **Migrations:** `20260710_0039_confirmed_sales.sql`, `20260710_0040_reputation_storage.sql`.
- **Existing legal drafts:** `docs/legal/consent-personal-data.md` (Consent-1 pattern to mirror for
  REVIEW_PUBLICATION), `docs/legal/launch-compliance-checklist.md` (A5 ст.10.1 precedent, B4 takedown).
- **Legal memory:** `zoolink-contact-reveal-live-consent-gap` (the R1 precedent), `golive-legal-posture`.

---
🌐 RU mirror: `docsRU/specs/security/reputation-fz152-legal-memo.md` (legally operative text).
_Advisory only. No `database_schema.sql`, migration, ERD, or code changed by this memo. All cited norms
must be re-verified as current before the owner relies on them. Analysis date 2026-07-10._
