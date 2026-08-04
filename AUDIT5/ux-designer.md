# ZooLink AUDIT5 — ux-designer · Axis №2 share: **flows & breaks at the API-experience level**

**Date:** 2026-08-04 · **Branch:** `backend` · **HEAD:** `c44874c` · **Role:** ux-designer
**Scope handed to me:** (1) the notification loop — where does an IN_APP notification *lead*;
(2) orphan states — a **generated** list of every entity status, each checked for "does a human
have a next step or an explanation"; (3) RFC7807 errors through a non-specialist's eyes, with
samples; (4) empty states of `/me/notifications`, `/saved-searches`, `/favorites`.
**Prior lane:** `AUDIT3/ux-designer.md` (no AUDIT4 ux lane existed) — diffed, not repeated.

**Method:** contracts + code + **live dev DB read-only** (`psql -X`, no writes, no tests run).
Status vocabularies and the error inventory are **machine-generated** from
`database_schema.sql` and from every `*Exception({...code:...})` site — not hand-listed
(handwritten-worklist law). Every defect below carries a **verbatim sample** pulled from the
running database or the exact source line.

**Finding format:** `[sev][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED] file:line → problem → fix`
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO. `antaraya:` per `agent-os/design/antaraya-taxonomy.md`.

---

## 0. What this lane CANNOT see (stated before the findings)

1. **No frontend exists.** Everything about rendering, copy, layout, motion, contrast and
   perceived speed is unobservable. I judge only what the **API makes possible or impossible**
   for any future client. Where a defect could in principle be papered over client-side I say so.
2. **The DB is a dev/e2e database, not production.** 2236 IN_APP rows and 3323 users are
   *fixture + e2e* data. I use it as **shape evidence** (what the code actually renders/stores),
   never as a production frequency claim. Where a number could be an artefact of e2e cleanup
   (notably the 447/447 dangling-target figure) I label it explicitly.
3. **I did not run the test suite** (boundary) — so "the code does X" claims are read from
   source + observed DB rows, not from a green/red run.
4. **Email/SMS delivery UX is invisible** — there is no provider wired in dev; I can only see
   the templates and the rows. The `saved_search_matched`/`transfer_*` **EMAIL** experience is
   therefore unaudited; I audit only the IN_APP projection of those same templates.
5. **Reputation/reviews is dormant** (ADR-0039 FORM slices, no endpoint, no consumer). I can
   audit its *reserved* state vocabulary for future orphan risk, not its behaviour.
6. **Localization quality of Russian copy** is judged only where I could read an actual rendered
   row; template wording that never fired in this DB (e.g. `transfer_expired` EMAIL subject) is
   read but not seen in situ.
7. **Not my lane, deliberately not judged:** access-control correctness (security), legal basis
   of consent (legal), metric definitions (data-analyst), and whether the *decision* to keep
   payments/chat gated is right (architect/owner).

---

## 1. TOP FINDINGS (severity · antaraya · file:line · sample)

| # | Sev | Antaraya | Where | One-line |
|---|-----|----------|-------|----------|
| **B1** | BLOCKER | `стьяна` (loop declared, mechanism absent) | `notification-api.yaml:307-329` · `dto/notification.dto.ts:38-46` · `database_schema.sql:555-570` | A notification carries **no navigable reference**. 2236/2236 IN_APP rows expose their target **only as a UUID inside a localized sentence**; 0 have a structured field. The loop cannot be closed by any client. |
| **B2** | BLOCKER | `бхранти-даршана` (the field named `listing_title` holds an id) · `прамада` | `notification.registry.ts:64-67` | Every moderation notification renders the **listing UUID where the title belongs** and the **raw machine reason code** where the human explanation belongs — while the human text sits one join away and is already used elsewhere. 447/447 rows affected in this DB. |
| **C1** | CRITICAL | `стьяна` (setting exists, no read-back) | `user-profile.util.ts:25-38` vs `dto/identity.dto.ts:143-176` | **Write-only contact settings.** `PATCH /me` accepts `showPhone/showTelegram/contactPhone/contactTelegram`; `GET /me` returns **none of them**. A seller can never see whether buyers can reach them. Observed: 1421 users with `show_phone=true`, **1** consent row, **0** contact-reveals. |
| **C2** | CRITICAL | `стьяна` (appeal is declared in the spec, exists nowhere in code or contract) | `user_state_machine.md:16,48` vs `grep -ri appeal src/ *.yaml` = **0 hits** | REJECT lands the listing in **DEACTIVATED** (`moderation.service.ts:569-570`), which is editable/withdrawable/submittable by **nothing**. The seller's only path is re-creating the listing from scratch. No appeal endpoint exists anywhere. |
| **C3** | CRITICAL | `аласья` (one short string instead of two states) | `identity.service.ts:239-241` · `auth.service.ts:12,38` | SUSPENDED and DEACTIVATED both return the **identical** opaque `403 {"code":"FORBIDDEN","detail":"Account is not active"}`. A 30-day self-recovery path **does exist** (`recovery.service.ts:25,129-136`) and is never mentioned to the person locked out. |
| **M6** | MAJOR | `бхранти-даршана` (an RU-first product answering in English with a machine title) | `problem.filter.ts:41-48,99-101` | Every RFC7807 body: `type` is always `about:blank`, `title` is the **HTTP status name** ("UNPROCESSABLE ENTITY"), `detail` is **English-only**. 47 distinct codes over 203 throw-sites; **0** localized, **0** with a doc URI. |
| **M2** | MAJOR | `стьяна` | `content-report.service.ts:150-185` · `dto/content-report.dto.ts:107-118` | Filing a report produces **no** outbox event, **no** notification and **no** resolution note. `DISMISSED` reaches the reporter (if they poll) as a bare word. |
| **M3** | MAJOR | `аласья` (N+1 pushed onto the client) | `listing.service.ts` list path vs `getById:277-279` (EMB-4) · `dto/listing.dto.ts:226+` | `lastModerationResult` is single-get-only and `GET /listings` has **no `status` filter** → a seller cannot build "listings needing my attention" without fetching everything and issuing one extra GET per listing. |
| **M4** | MAJOR | `бхранти-даршана` | `dto/favorite.dto.ts:42-51` · `listing.service.ts:269-272` | A favorite is `{id, offeringType, offeringId, listingId, createdAt}` — **no title, photo, price or status**. A favorited listing that leaves ACTIVE returns `404 NOT_FOUND` to the buyer → the shortlist silently grows holes with no "sold" vs "removed" distinction. |
| **M5** | MAJOR | `самшая` (a 200 that means "no", vaguely) | `listing.service.ts:597-602` | `NO_CHANNELS` is returned as **HTTP 200** with `channels:{}`, no reason, no next step — at the single highest-intent moment in the marketplace, with no chat fallback in MVP. |

---

## 2. Lane task #1 — the notification loop: where does it lead?

### The loop as built

```
Moderation.Decided / OwnershipTransfer.* / Listing.Activated   (outbox, in-tx)
        └→ NotificationConsumer | SavedSearchMatchConsumer      (worker)
              └→ NotificationWriter.materialize()               (renders EMAIL template → IN_APP row)
                    └→ notification_logs                        (id, type, template_id, recipient, content, status)
                          └→ GET /v1/me/notifications           (id, type, content, status, createdAt)
                                └→ ??? ← the loop ends here
```

**Live evidence — what the loop actually delivers to a person (verbatim `notification_logs.content`):**

```
Вам предложена передача владения животным (заявка e9b57aba-3f50-4ae4-808c-d78af6f5ce12).
Подтвердите или отклоните её в личном кабинете.

Объявление «fa65a31e-43e0-4bf8-9181-ff8524bab414» одобрено и опубликовано.

Объявление «aeb57322-5a40-4c32-b713-0361c24f5018» отклонено. Причина: poor_photos.

По объявлению «49ee517f-7ed8-40e3-b626-760d48de15df» нужны правки: poor_photos.

По вашему сохранённому поиску появилось новое объявление: Котёнок.
Откройте его в приложении (id da179643-6ff3-4aa9-b45b-357fa7a1f8f9).
```

**Named-payload numbers (this DB, `psql`):**

| Template | Rows | Renders a real subject name? | Structured target field? |
|---|---:|---|---|
| `transfer_initiated` | 1068 | no — transfer UUID, animal never named | no |
| `transfer_accepted` | 397 | no | no |
| `listing_approved` | 391 | **no — listing UUID in the title slot** | no |
| `transfer_expired` | 132 | no | no |
| `transfer_cancelled` | 122 | no | no |
| `transfer_declined` | 66 | no | no |
| `listing_rejected` | 55 | **no** + raw reason code | no |
| `saved_search_matched` | 4 | **yes** ("Котёнок") | no (id in prose) |
| `listing_changes_requested` | 1 | **no** + raw reason code | no |
| **total IN_APP** | **2236** | — | **0 of 2236** |
| rows whose target appears **only as a UUID inside prose** | **2236 / 2236 = 100 %** | | |
| distinct values of `status` across all IN_APP rows | **1** (`SENT`) | | |

---

### B1 — the notification is a dead end: no navigable reference anywhere in the chain

`[BLOCKER][dead-end][NEW]` `docs/03-architecture/api-contracts/notification-api.yaml:307-329` ·
`backend/src/modules/notification/dto/notification.dto.ts:38-46` ·
`backend/src/modules/notification/notification-read.service.ts:58-66` ·
`ZooLink/database_schema.sql:555-570`

The break is **structural, at three layers at once**, which is why no client can work around it:

* **Storage:** `notification_logs` has `id, user_id, type, template_id, recipient, content,
  status, provider_response, attempts, created_at, updated_at`. There is **no subject column**
  — no `entity_type`, no `entity_id`, no `deep_link`, no `event_id` back-pointer.
* **Projection:** `NotificationView = {id, type, content, status, createdAt}` (dto:38-46). The
  service *does* select `template_id` in the row interface but deliberately drops it (dto:35-37
  "internal columns … are deliberately omitted"). So the client cannot even learn **what kind**
  of notification this is, let alone about what.
* **Contract:** the `Notification` schema (yaml:313-329) has the same five fields, so this is
  the intended contract, not an implementation slip.

Consequence, stated as a designer: **the only way a client can build "tap the notification →
open the thing"** is to run a UUID regex over a **localized natural-language sentence** and then
guess which entity type that UUID belongs to from the surrounding Russian (or English) words.
That is not an integration seam; that is screen-scraping our own API. It breaks the moment a
template is reworded, and it is impossible for the `en` variants and any third locale.

`antaraya: стьяна (объявление есть, действия нет — ADR-0021 объявил «you were told» и построил
запись, но того, ЧЕМ клиент перейдёт к предмету, в записи нет)`

**Corroborating structural evidence (labelled honestly).** In this DB, **447 / 447 (100 %)** of
`listing_*` notifications point at a listing row that no longer exists, and 4/4
`saved_search_matched` likewise. **This number is an e2e-cleanup artefact and I do not claim it
for production.** What it *does* prove is structural and production-relevant: there is **no FK,
no cascade and no tombstone** between a notification and its subject, so a notification can and
does outlive its subject — and when the user taps it, the client's only possible response is a
bare `404 NOT_FOUND` with no way to say *why* it is gone.

**Fix (UX-owned shape; schema change is architect/backend):**
1. Add to `notification_logs` and to the `Notification` schema a **structured target**:
   `subjectType` (LISTING | OWNERSHIP_TRANSFER | SAVED_SEARCH | …), `subjectId`, and a stable
   `kind` (= template name, e.g. `listing_changes_requested`). `kind` is what a client switches
   on to pick an icon, a tone and a CTA; `subjectType/subjectId` is what it navigates with.
2. Add an explicit **`action`** hint per kind (`{type: "OPEN_LISTING" | "REVIEW_TRANSFER" | …}`)
   so the CTA label is a product decision recorded server-side, not re-invented per client.
3. Design the **"subject is gone"** state now: a notification whose subject cannot be resolved
   must render as *historical* ("объявление удалено") rather than as a broken tap.
4. Keep `content` as the human sentence — it stays the accessible/no-JS/email-parity payload.

---

### B2 — the notification tells the seller a UUID and a machine code, while the human words exist one join away

`[BLOCKER][content-truth][NEW]` `backend/src/modules/notification/notification.registry.ts:62-67`

```ts
// notification.registry.ts:64-67  ('Moderation.Decided')
context: (p) => ({
  listing_title: str(p.entityId) ?? '',   // ← the listing's UUID, in the field named "title"
  reason: str(p.reason) ?? '',            // ← moderation_reasons.code, e.g. "poor_photos"
}),
```

Rendered against `migrations/20260617_0010_seed_reasons_templates.sql:29`, the seller receives —
verbatim, from the live table:

> `По объявлению «49ee517f-7ed8-40e3-b626-760d48de15df» нужны правки: poor_photos.`

Two independent content-truth defects in one row:

1. **The title slot holds an identifier.** The field is literally named `listing_title` and is
   fed `entityId`. 447/447 `listing_*` rows in this DB are affected. A seller with three live
   listings cannot tell **which one** was rejected without opening all three.
2. **The reason slot holds a machine code.** `poor_photos` is `moderation_reasons.code`. The
   human text is in the very same table and reads:
   `{"ru": "Некачественные или чужие фото", "en": "Poor-quality or non-original photos"}`
   (verified: `SELECT description_localized FROM moderation_reasons WHERE code='poor_photos'`).
   It is **already resolved and returned** by `moderation.service.ts:545-549` for
   `GET /listings/{id}/moderation-result`. So the correct string is not missing — it is simply
   not used on the one surface the user actually receives.
3. **The moderator's free-text `notes` — the actual "what to change" — is never carried at
   all.** `ModerationActionDto.notes` allows 4000 chars (`dto/moderation.dto.ts:102-106`), it is
   persisted (`moderation.service.ts:392-404`) and returned by `getOwnerResult`
   (`moderation.service.ts:554`), but the `Moderation.Decided` payload
   (`moderation.service.ts:436-441`) omits it, so the notification cannot render it.

**This is a within-wave inconsistency, which is what makes it cheap to fix.** The July H4
follow-up added exactly the mechanism needed — `MaterializeOptions.localized`
(`notification-writer.service.ts:17-34,108-119`) resolves a per-recipient localized value. It
was applied to `saved_search_matched`, which is why that template renders the real title
("Котёнок") — and was **not** applied to `Moderation.Decided`.

`antaraya: бхранти-даршана (поле, объявленное как listing_title, несёт entityId — рендер мерит
не то, что объявляет) · прамада (человеческий текст лежал в той же таблице и уже использовался
соседним эндпоинтом — не посмотрели)`

**Fix:** in the `Moderation.Decided` producer, stamp `titleLocalized`, `reasonDescriptionLocalized`
and `notes` into the payload (the producer already holds `title_localized` — it is selected at
`moderation.service.ts:580`); in the registry, pass title and reason-description through
`opts.localized` exactly as `SavedSearchMatchConsumer` does, and add `{{notes}}` to the three
`listing_*` templates behind a "when present" clause. Then the seller reads:
*«По объявлению „Котёнок, 2 мес.“ нужны правки: некачественные или чужие фото. Комментарий
модератора: …»* — which is a complete instruction, not a puzzle.

---

### M8 — transfer notifications never name the animal

`[MAJOR][content-truth][NEW]` `notification.registry.ts:75,81,87,93,103` ·
`migrations/20260704_0030_notification_in_app_channel.sql:45-46`

1068 `transfer_initiated` rows say *«Вам предложена передача владения животным (заявка
e9b57aba-…)»*. The registry context carries `animal_id` (registry:75) but the template never
uses it — and using it would only substitute a second UUID. The recipient of an ownership
transfer — an emotionally loaded, irreversible act — is told a request id and nothing about
**which animal**. `antaraya: аласья (в контекст положили id, потому что это дёшево, вместо клички,
которая требует чтения агрегата)`
**Fix:** carry `animalNicknameLocalized` in the transfer event payload (the transfer service
already resolves the animal aggregate for `market`), render it via the same `localized` seam.

---

### m1–m3 (MINOR/INFO, same loop)

`[MINOR][state][NEW] notification-read.service.ts:68-78` — the ETag is documented as "over the
caller's **inbox** state" but is computed from `total` + the **max `updated_at` of the current
page only**. An in-place update of a row outside the requested page rotates nothing → a stale
`304`. Latent today (IN_APP rows are never updated after insert) — becomes real the day
read-state or delivery-state is added, which is exactly the next feature.
`antaraya: бхранти-даршана (валидатор объявлен по инбоксу, считается по странице)`

`[MINOR][retention][NEW] dto/notification.dto.ts:38-46` — **no read/unread state.** `status` is
a *delivery* enum and is constant (`SENT` for 2236/2236 rows), so it carries zero information to
a reader. A client cannot render an unread badge, cannot mark-as-read, and cannot show
"3 new since your last visit" — the single cheapest retention affordance in the product.
**Fix:** `readAt: timestamptz|null` + `PATCH /me/notifications/{id}/read` (and/or a bulk
`readUpTo`), plus `meta.unreadTotal` on the list.

`[MINOR][fairness][NEW] saved-search-match.consumer.ts:11,91-96` — the saved-search fan-out is
capped at `MAX_MATCHES_PER_LISTING = 500`; beyond it, matches are **silently truncated** and the
only trace is a server-side `logger.warn`. From the user's side this is an invisible, unequal
service: the 501st person who saved that search is simply never told, forever, with no signal.
`antaraya: стьяна (обещание «мы сообщим» есть, для части людей механизма нет)`
**Fix:** page the fan-out rather than truncating it; until then, treat the cap breach as an
operational alert, not a log line.

---

## 3. Lane task #2 — orphan states (generated list)

**Generation:** every `CHECK (<col> IN (…))` on a status-shaped column in
`ZooLink/database_schema.sql`, extracted by script (not typed by hand), each associated with its
owning `CREATE TABLE`/`ALTER TABLE`. **17 vocabularies found; the 13 user-reachable ones are
audited below** (4 are dictionary/gated: `payment_transactions`, `refunds`, `digital_assets` ×2 —
all behind `feature_toggles.payments`/Phase-2 and correctly out of MVP scope).

| Entity.column | schema:line | Vocabulary |
|---|---|---|
| `users.status` | 121 | UNVERIFIED, PENDING_VERIFICATION, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED |
| `listings.status` | 289 | DRAFT, PENDING_MODERATION, ACTIVE, EXPIRED, SOLD, DEACTIVATED |
| `listings.moderation_status` | 292 | PENDING, APPROVED, REJECTED, CHANGES_REQUESTED |
| `moderation_decisions.decision` | 452 | APPROVED, REJECTED, CHANGES_REQUESTED |
| `content_reports.status` | 495 | OPEN, REVIEWED, DISMISSED, ACTIONED |
| `notification_logs.status` | 565 | SENT, DELIVERED, FAILED, BOUNCED |
| `ownership_transfers.status` | 590 | PENDING, IN_PROGRESS, COMPLETED, FAILED, CANCELLED |
| `confirmed_sales.status` | 682 | PENDING_CONFIRMATION, CONFIRMED, DISPUTED, EXPIRED, CANCELLED *(dormant)* |
| `reviews.moderation_status` | 733 | PENDING, APPROVED, REJECTED, CHANGES_REQUESTED *(dormant)* |
| `organizations.status` | 1293 | PENDING_VERIFICATION, ACTIVE, SUSPENDED, ARCHIVED |
| `organization_users.status` | 1301 | PENDING_INVITE, ACTIVE, REVOKED, EXPIRED |

### 3.1 `listings.status` — the seller's lifecycle

Action sets read from code (`listing.service.ts:51` `WITHDRAWABLE`, `:331` editable gate, `:454`
submit gate, `:747` mark-sold gate):

| Status | How you get here | Next step available to the **human**? | Explanation surfaced? |
|---|---|---|---|
| DRAFT | create; **REQUEST_CHANGES** (`moderation.service.ts:571-572`) | ✅ edit / submit / withdraw | ⚠️ only via a **second call** (`GET /listings/{id}` → `lastModerationResult`) |
| PENDING_MODERATION | submit | ✅ withdraw | ⚠️ no ETA, no queue position |
| ACTIVE | APPROVE | ✅ edit (re-enqueues) / mark-sold / withdraw | ✅ |
| **EXPIRED** | duration elapsed | ❌ **nothing** — not editable (`:331`), not withdrawable (`:51`), not submittable (`:454`) | ❌ |
| SOLD | mark-sold | ❌ (correct — terminal by design) | ✅ |
| **DEACTIVATED** | withdraw **or REJECT** (`moderation.service.ts:569-570`) | ❌ **nothing** | ⚠️ notification only, unusable (B2) |

#### C2 — REJECT is a cliff, and the appeal it promises does not exist

`[CRITICAL][dead-end][NEW]` `moderation.service.ts:565-573` · `listing.service.ts:51,331,454` ·
`docs/specs/statemachines/user_state_machine.md:16,48`

`REJECT` → `DEACTIVATED`, and `DEACTIVATED` accepts **no owner action of any kind**. A seller
whose listing was rejected for `poor_photos` cannot replace the photos and resubmit; they must
re-create the listing from zero (re-enter title, description, price, geo, re-upload photos).
Compare `REQUEST_CHANGES` → `DRAFT`, which *is* recoverable — so the platform already knows how
to do this correctly and chose the cliff for the neighbouring verdict.

Worse, the spec **promises an appeal** that has no implementation and no contract:
`user_state_machine.md:16` `SUSPENDED --> ACTIVE: appeal approved`, `:48` "Appeal successful".
`grep -ri appeal` over `backend/src/**` and over all 14 `api-contracts/*.yaml` returns **0 hits**.
So the one documented remedy for the harshest moderation outcome is a word in a diagram.

`antaraya: стьяна (апелляция объявлена в спеке государством машины, механизма нет ни в коде, ни
в контракте — объявление без действия)`

**Fix (UX shape, needs an architect call on the state model):** either (a) make REJECT land in
`DRAFT` with `moderation_status = REJECTED` — recoverable, mirroring CHANGES_REQUESTED, with the
re-submit gated on the reason being addressable; or (b) keep DEACTIVATED terminal but add an
explicit **"duplicate to a new draft"** action that pre-fills everything from the rejected
listing. Either way the notification must carry the CTA. Until an appeal exists, remove the
appeal transitions from `user_state_machine.md` — a documented remedy the product does not have
is worse than none.

#### M1 — EXPIRED has zero actions, while the spec documents a renew

`[MAJOR][dead-end][CONFIRMED from AUDIT3]` `listing.service.ts:331,51,454` vs
`docs/specs/statemachines/listing_state_machine.md:29,67,99`

The state machine states plainly (`:29`) `EXPIRED --> DRAFT: owner renews (re-enters moderation)`
and (`:99`) "EXPIRED listings renew by resetting to DRAFT". Code offers **no** transition out of
EXPIRED: the edit gate (`:331`) excludes it, `WITHDRAWABLE` (`:51`) excludes it, `submit`
requires DRAFT (`:454`). This is the same three-way SM↔code↔flow drift AUDIT3 reported; the July
wave did not touch it. It is a **retention** defect, not just a drift: a seasoned seller's
natural repeat action ("relist last season's litter") is impossible.

#### M3 — the seller cannot build "what needs my attention"

`[MAJOR][friction][NEW]` `listing.service.ts:277-279` (EMB-4) · `dto/listing.dto.ts:226-290`

Two independent gaps compose into one bad screen:
* `lastModerationResult` is populated **only** on `GET /listings/{id}` (EMB-4, deliberate) — so
  the list gives `status: "DRAFT", moderationStatus: "CHANGES_REQUESTED"` with **no reason**.
* `ListingListQueryDto` has **no `status` / `moderation_status` filter** (only `animal_id`,
  `seller_id`, `organization_id`, `branch_id`, `listing_type`, price, market, species, geo, sort).

So the "3 of your listings need changes" screen requires fetching *every* listing the seller owns
across all pages, filtering client-side, and then issuing **one extra GET per flagged listing**
to learn why. `antaraya: аласья (стоимость сборки экрана переложена на клиента вместо одного
серверного фильтра)`
**Fix:** add `status`/`moderation_status` to the list filter, and embed a **minimal** moderation
summary in the list for the owner's own rows (`{decision, reasonLocalized}` — not the full
object, keeping EMB-4's leak boundary intact since it is owner-scope anyway).

### 3.2 `users.status` — the person's lifecycle

#### C3 — SUSPENDED and DEACTIVATED are the same opaque sentence, and the exit that exists is never mentioned

`[CRITICAL][dead-end][NEW]` `identity.service.ts:41,239-241` · `auth.service.ts:12,36-39` ·
`recovery.service.ts:25,124-136`

```ts
// identity.service.ts:41
const LOGIN_BLOCKED_STATUSES = new Set(['SUSPENDED', 'DEACTIVATED']);
// identity.service.ts:239-241
throw new ForbiddenException({ message: 'Account is not active', code: 'FORBIDDEN' });
```

Sample response the person actually receives (shape from `problem.filter.ts:41-48`):

```json
{ "type": "about:blank", "title": "FORBIDDEN", "status": 403,
  "code": "FORBIDDEN", "detail": "Account is not active",
  "instance": "/v1/auth/verify", "requestId": "…" }
```

For **both** states. A suspended person is not told they were suspended, why, for how long, or
by whom; a deactivated person is not told that a **30-day self-recovery window exists** —
`recovery.service.ts:25` `DEACTIVATION_GRACE_MS = 30 days`, `:124-136` reactivates
`DEACTIVATED → ACTIVE` within grace. The product built the humane exit and then hid it behind a
string that says nothing. This is the highest-emotion moment in the whole product and it has the
least information in it. `antaraya: аласья (одна общая строка вместо двух разных состояний с
разными следующими шагами)`

**Fix:** distinct codes and distinct human copy —
`ACCOUNT_SUSPENDED` (with `suspendedUntil` when bounded, the reason, and the appeal route once
C2's appeal exists) and `ACCOUNT_DEACTIVATED_RECOVERABLE` (with `recoverableUntil` and the exact
recovery call). Both localized (M6). This does **not** widen an oracle: the caller has already
proven possession of the credential at this point in both flows.

#### Doc↔code drift **inverted** since AUDIT3 — worth flagging to doc-keeper

`[MAJOR][doc-spec][SEV-CHG/REFUTED]` `docs/specs/statemachines/user_state_machine.md:19,63-64`
says "From DEACTIVATED, no transitions are possible (account is permanently removed)". Code now
implements a **30-day recoverable** DEACTIVATED (`recovery.service.ts:124-136`,
`profile.service.ts:18`). AUDIT3 flagged `user-flows.md:29` ("can be reactivated later") as the
error; **the flow doc is now right and the state machine is the stale artefact.** Fix the state
machine, not the flow doc. (Mirror to `docsRU/`.)

### 3.3 `content_reports.status` — the reporter is never told

#### M2 — report resolution has no return path at all

`[MAJOR][trust][NEW]` `content-report.service.ts:150-185` · `dto/content-report.dto.ts:107-118`

`OPEN → REVIEWED | DISMISSED | ACTIONED`. Checked against the whole notification chain:
* the resolve transaction writes the row + an audit entry and **publishes no outbox event**
  (`grep outbox content-report.service.ts` = 0 hits) — so no consumer can ever notify;
* `NOTIFICATION_REGISTRY` (registry.ts:53-105) has **6 entries**, none for content reports;
* `ContentReportView` (dto:107-118) exposes `status` but **no resolution note** — the moderator's
  `notes` field on the report is the *reporter's* note, not the resolver's; there is no
  resolver-side text column at all.

So a person who reports a suspected scam gets: silence, and — only if they think to poll
`GET /content-reports` — the bare word `DISMISSED`, with no reason and no recourse. Reporting is
the core trust-and-safety loop of a live-animal marketplace; an unacknowledged report teaches
people not to report again. `antaraya: стьяна (петля жалобы объявлена и построена наполовину —
приём есть, возврата нет)`

**Fix:** emit `ContentReport.Resolved` in the resolve tx; register it in
`NOTIFICATION_REGISTRY` with three templates (reviewed / dismissed / actioned); add a
`resolution_note` column + `resolutionNote` on the view; and — the cheap half — return an
**acknowledgement** on `POST /content-reports` that states what happens next and by when.

### 3.4 `ownership_transfers.status` — the best-designed lifecycle in the product

`[INFO][journey][NEW]` Credit where due: `TransferView` (`transfer.service.ts:818-843`) carries
`status`, **`terminalReason`** (so `CANCELLED(expired)` is distinguishable from
`CANCELLED(by initiator)` — `:820`, `:514-524`), `expiresAt`, `completedAt`, and **actor display
names** on both `initiatedBy`/`respondedBy`. Every PENDING transfer has accept/decline/cancel
endpoints. This is the shape the other three domains should copy — in particular the pairing of
a terminal status with a machine-readable **reason for terminality**.

Two residual gaps: the notification never names the animal (M8), and the view returns `animalId`
only — so a "pending transfers" screen still needs one `GET /animals/{id}` per row to show a
nickname or photo (same class as M3/M4).

### 3.5 Dormant vocabularies — the orphan class is being pre-built

`[INFO][forward-compat][NEW]` `database_schema.sql:733` (`reviews.moderation_status`) ·
`:682` (`confirmed_sales.status`)

`reviews.moderation_status` reserves **CHANGES_REQUESTED** — i.e. the reputation slice is
pre-building the exact status that is today's worst orphan (B2/M3: the person is told changes are
needed but not what to change). And `confirmed_sales.status` reserves `DISPUTED` with no dispute
surface designed. These are FORM slices, so nothing is broken — but the cost of designing the
"how does the author learn what to fix / how does a party open and follow a dispute" flow is
lowest **now**, while no behaviour is written. `antaraya: анавастхитатва (класс дефекта уже
однажды пойман — если не удержать урок, он переедет в новый домен)`
**Ask:** before the reputation behaviour slice opens, I owe a review-lifecycle flow that includes
the author-facing "what to change" payload from day one.

---

## 4. Lane task #3 — errors through a non-specialist's eyes

**Generation:** every `*Exception({ … code: '…' })` site in `backend/src/**` (excluding `*.spec.ts`),
extracted by script → **203 throw-sites, 47 distinct codes**. Wire shape from
`problem.filter.ts:41-48,99-101,103-128`.

### M6 — the envelope itself fails the non-specialist, uniformly

`[MAJOR][a11y/localization][NEW]` `backend/src/lib/http/problem.filter.ts:41-48,99-101`

```ts
const problem: ProblemDetails = {
  type: 'about:blank',                 // :42  — never a documentation URI, on any of 203 sites
  title: this.titleFor(status),        // :43  — HttpStatus[status].replace(/_/g,' ') → "CONFLICT"
  status, code: codeForStatus(status),
  instance: req.originalUrl, requestId,
};
```

Three envelope-level defects, all affecting **100 % of error responses**:

1. **`type` is always `about:blank`.** RFC7807's `type` is the one field designed to point a
   confused human (or their developer) at an explanation. We have 47 codes and 0 explanations.
2. **`title` is the HTTP status name.** "CONFLICT", "UNPROCESSABLE ENTITY", "PRECONDITION
   REQUIRED". RFC7807 asks for "a short, human-readable summary of the problem **type**"; a
   status name is neither human nor type-specific — and it is what a naive client will most
   likely render as the error heading.
3. **`detail` is English-only, in an RU-primary product.** `Accept-Language ru|en` is honoured for
   reference data (`name_localized`), for notification delivery (`preferredLanguage`,
   `notification-writer.service.ts:121-126`) and for moderation reasons — but **not** for a single
   one of the 203 error messages. A Russian pet owner is told *"A DEACTIVATED listing cannot be
   edited"*.

`antaraya: бхранти-даршана (конверт объявлен как RFC7807-контракт для человека, а несёт машинное
имя статуса и чужой язык — заявленное и отдаваемое расходятся)`

**Fix:** (a) `type: https://api.zoolink.../problems/{code}` and a generated problem-code page —
this is also the artefact that makes the 47 codes reviewable as *copy*; (b) `title` = a short
human summary per code; (c) localize `detail` via the existing `LocalizedString`/Accept-Language
machinery, keeping `code` as the stable machine contract. UX owns the RU/EN copy for all 47.

### Required samples — the four July-wave codes, as the person receives them

**(1) `409 LISTING_NOT_EDITABLE`** — `listing.service.ts:332`

```json
{ "type":"about:blank", "title":"CONFLICT", "status":409, "code":"LISTING_NOT_EDITABLE",
  "detail":"A DEACTIVATED listing cannot be edited",
  "instance":"/v1/listings/49ee517f-…", "requestId":"…" }
```
*Читатель-непрофессионал:* "DEACTIVATED" is an internal enum in an English sentence; the person
knows their listing was **rejected**, not "deactivated" — the word they were told (B2) and the
word they now see do not match. And nothing states the next step, because (C2) there **is** none.
→ **`detail`:** «Это объявление отклонено модератором и больше не редактируется. Создайте новое
объявление на его основе — мы перенесём все данные.» + `errors:[{field:"status", …}]`.

**(2) `422 MARKET_REQUIRED`** — `listing.service.ts:1030`

```json
{ "type":"about:blank", "title":"UNPROCESSABLE ENTITY", "status":422, "code":"MARKET_REQUIRED",
  "detail":"A market filter is required for this search", "instance":"/v1/listings?limit=20" }
```
*Читатель-непрофессионал:* this fires on the **anonymous first search** — the very first request a
new visitor's client makes. It does not name the parameter (`market`), does not list the two legal
values (`pet` | `livestock`), and does not say why a choice is needed. The ADR-0002 market split is
a deliberate product concept and this error is the **only place** a newcomer meets it.
→ **`detail`:** «Выберите раздел: домашние животные (`market=pet`) или сельскохозяйственные
(`market=livestock`).» + `errors:[{"field":"market","message":"допустимые значения: pet, livestock"}]`.
This is the one error that should arguably not be an error at all — a first-run market chooser is
UX I owe the flow doc.

**(3) `403 ISSUANCE_HUMAN_ONLY`** — `agent-credential.service.ts:201`

```json
{ "type":"about:blank", "title":"FORBIDDEN", "status":403, "code":"ISSUANCE_HUMAN_ONLY",
  "detail":"Credential issuance is a HUMAN-only capability", "instance":"/v1/admin/agents/…/credentials" }
```
*Verdict:* **acceptable as-is.** The audience is an ADMIN operator or an AI principal (ADR-0006),
not a pet owner; the message names the exact rule and the rule is the point. My only note: it
should still get a `type` URI, because "why is this human-only?" is precisely the question an AI
operator's human overseer will ask. Localization: low priority here.

**(4) `429 RATE_LIMITED` (contact-reveal quota)** — `listing.service.ts:674-682`

```json
{ "type":"about:blank", "title":"TOO MANY REQUESTS", "status":429, "code":"RATE_LIMITED",
  "detail":"Contact reveal limit reached (10/hour for the pet marketplace)",
  "instance":"/v1/listings/…/contact-reveal", "requestId":"…" }
```
`Retry-After: 2731` · `X-RateLimit-Limit`/`-Remaining` are emitted (`problem.filter.ts:53-74`).
*Читатель-непрофессионал:* the best of the four — it states the limit and the market. Two gaps:
**(a)** the *when* lives only in a header; the body should carry `retryAfterSeconds` (or a
`retryAt` timestamp) so a naive client can say «попробуйте через 46 минут» without header
plumbing — note the OTP path already does embed it in the message
(`identity.service.ts:276`: *"Please wait Ns before requesting a new code"*), so the codebase is
**inconsistent with itself**; **(b)** it does not say *why* a limit exists — a buyer who has just
been throttled reads it as punishment, whereas one clause ("чтобы продавцов не заваливали
обращениями") converts it into a trust signal.
`antaraya: самшая (расплывчатое «retry later» вместо числа, при том что число уже посчитано
строкой выше)`

### One more the lane must name: `412 STALE_RESOURCE` / `428 PRECONDITION_REQUIRED`

`[MAJOR][friction][NEW]` `lib/http/etag.util.ts:24-38`

```json
{ "title":"PRECONDITION FAILED", "status":412, "code":"STALE_RESOURCE",
  "detail":"Resource has changed; re-fetch and retry" }
{ "title":"PRECONDITION REQUIRED", "status":428, "code":"PRECONDITION_REQUIRED",
  "detail":"If-Match header is required for this update" }
```

The 428 text names an **HTTP header** — it is a developer message that will be shown to an end
user by any client that renders `detail` generically. The 412 arrives after a person has typed a
long description, and says only "re-fetch and retry" — i.e. *your text may be gone, figure it
out*. This is where a marketplace loses a listing's worth of typing.
→ **`detail` (412):** «Объявление изменилось в другом окне. Мы сохранили ваш текст — обновите
страницу и примените правки заново.» + an explicit `errors[]` naming the fields that changed, so
a client can offer a merge rather than a reload. → **428** should never reach a human: it is a
client-integration bug and its copy should say so.

---

## 5. Lane task #4 — empty states

All three endpoints return the same envelope (`lib/pagination/page.ts:14-23`):

```json
{ "items": [], "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }
```

| Endpoint | Empty payload | Enough for a meaningful UI? |
|---|---|---|
| `GET /v1/me/notifications` (`notification.controller.ts:35-52`) | `{items:[], meta:{…total:0}}` + weak `ETag` + `Cache-Control: private, no-store` | **Yes, for "nothing yet".** But there is no `unreadTotal`, so the badge state cannot be derived, and the empty state cannot distinguish "you have never received anything" from "you have read everything" — the two need different copy. |
| `GET /v1/saved-searches` (`saved-search.controller.ts:46`) | same, **no ETag** (`:39` "no ETag/If-Match on any endpoint") | **Barely.** Sufficient to say "no saved searches". Not sufficient to say anything useful *afterwards*: `SavedSearchView` (`dto:162-176`) has no `lastMatchedAt`, no `matchCount`, no `notifyEnabled` — so even the **non-empty** state cannot show "12 new since Tuesday", which is the entire reason to save a search. |
| `GET /v1/favorites` (`favorite.controller.ts:44-52`) | same, no ETag | **No — see M4.** Even non-empty it is unrenderable without N extra calls; and empty vs. "all my favorites 404 now" look identical to the user. |
| *(adjacent, the important one)* `GET /v1/listings` zero results | same | **No.** No echo of the applied filters, no `appliedRadiusKm`, no suggestion payload. A thin-supply marketplace's most common screen ("нет котят в радиусе 10 км") has nothing to build "расширить до 50 км / убрать фильтр породы / сохранить поиск и мы сообщим" from, other than the client's own request object. Reserving `meta.appliedFilters` + `meta.nearestAlternativeRadiusKm` is cheap now. |

### M7 — the return loop is built, but the person has no control over it and no view of it

`[MAJOR][retention/consent][NEW]` `dto/saved-search.dto.ts:162-176` ·
`notification-api.yaml:330-342` · `migrations/20260708_0037_…sql:6-13` ·
`saved-search.controller.ts:46,56,70`

* `SavedSearchView` has **no `notifyEnabled`** — and the design decision (migration 0037) is
  "transactional-always, **opt-out = delete the saved search**". So the only way to stop the
  alerts is to destroy the search itself. That is a false choice: "keep the search but stop the
  pings" is the normal human want, and it is unexpressible.
* `NotificationPreferences` (`yaml:330-342`) is `{email, sms, promo}` — **no `inApp`**, even
  though IN_APP is now a first-class channel with 2236 rows. The user has zero volume control
  over the one channel that actually delivers.
* There is **no `PATCH /saved-searches/{id}`** (`:46,56,70` = GET / POST / DELETE only) — a saved
  search cannot be renamed or retuned; widening a radius means delete + recreate, which also
  resets its (unexposed) match history.

`antaraya: стьяна (петля возврата объявлена как гуманная — «уведомим о совпадении» — но органа
управления ей у человека нет; выключатель = уничтожение предмета)`
**Fix:** `notifyEnabled` on the saved search (default true), `inApp` in notification prefs,
`lastMatchedAt` + `newMatchCount` on the view, and a `PATCH`. None of these are new tables.

### M4 — favorites: an id-only list over a collection that silently loses members

`[MAJOR][dead-end][NEW]` `dto/favorite.dto.ts:42-51` · `favorite.service.ts:90-104,116-125` ·
`listing.service.ts:269-272`

`FavoriteView = {id, offeringType, offeringId, listingId, createdAt}`. To render one shortlist
card the client must call `GET /listings/{id}`; for a full page, up to **100 extra calls**. And
`getById` returns `404 {"code":"NOT_FOUND","detail":"Listing not found"}` to a non-owner for
**any** non-ACTIVE listing (`:270-272`) — SOLD, EXPIRED, DEACTIVATED and rejected are all the
same 404. So the buyer comparing three kittens watches cards vanish with no signal, and cannot
tell "продан" (a normal, even reassuring outcome — the marketplace works) from "снят" or
"удалён". `antaraya: бхранти-даршана (одно и то же 404 покрывает четыре разных человеческих
исхода — ответ не различает того, что различает предметная область)`
**Fix:** embed a **minimal card projection** in `GET /favorites` (`titleLocalized`, first photo,
`priceCents`, `status`, `market`) — the favorite is owner-scope, so this leaks nothing new; and
give the buyer a **tombstone** state for a favorite whose listing left ACTIVE (`status: "SOLD"`
is not a leak — it is the outcome the marketplace exists to produce, and showing it is a trust
gain, not a loss).

### M5 / C1 — the contact loop: the buyer gets a shrug, the seller gets no mirror

`[MAJOR][dead-end][NEW]` `listing.service.ts:597-602` — **buyer side.** A `NO_CHANNELS` reveal is
`HTTP 200` with `channels:{}`, `revealedAt:null`, `status:"NO_CHANNELS"`. Correctly free (no
quota burnt — see §6), but from the buyer's chair: they pressed the one button that exists,
nothing happened, no reason was given, and MVP has **no chat fallback**. The journey simply ends.
→ Design a first-class state: name the cause in product terms («продавец пока не открыл контакты»),
offer the only honest next actions (favorite it and be notified if the seller opens contacts;
report the listing; see similar nearby), and — the missing loop — **notify the seller** that
someone tried to reach them and could not. That last one is a pure win-win: it converts a dead
end into the strongest possible nudge to complete a profile.

`[CRITICAL][dead-end][NEW]` `user-profile.util.ts:25-38` vs `dto/identity.dto.ts:143-176` —
**seller side, and this is the deeper one.** `PATCH /me` accepts `contactPhone`, `contactTelegram`,
`showPhone`, `showTelegram` (dto:143-176) and records the `CONTACT_DISTRIBUTION` consent
(`profile.service.ts:82-94`). `GET /me` returns `{id, fullName, role, status, isActive, cityId,
email, emailVerified, avatarUrl, preferredLanguage, createdAt}` — **not one of the four**. The
contract agrees (`auth-api.yaml:901-…`: no contact properties). So:

* a settings screen **cannot render the current value of its own toggles**;
* the `PATCH` response is the same `UserProfile` → **not even a write is confirmed back**;
* a seller can never answer "can buyers reach me right now?" — the single question that decides
  whether their listing earns anything.

Observed in this DB (shape evidence, not a production frequency claim): **1421 of 3323** users
have `contact_prefs.show_phone = true`, there is exactly **1** row in `consents`, and **0** rows
in `contact_reveals`. Whatever the provenance of those rows, they describe precisely the state
the product cannot show anyone: *visibility flag on, lawful basis absent → every buyer gets
`NO_CHANNELS`, and neither side is ever told.* `antaraya: стьяна (тумблер есть, показания
прибора нет — настройка со стороны человека декоративна)`

**Fix (small, and it unblocks the marketplace's only conversion event):** return
`contactPhone` (masked, e.g. `+7 ··· ··45`), `contactTelegram`, `showPhone`, `showTelegram` **and
a derived `contactReachable: boolean` + `contactBlockedReason`** (`NO_CONSENT` | `NO_CHANNEL_SET`
| `ALL_CHANNELS_OFF`) on `GET /me`. `contactReachable` is the field that makes the seller's own
state legible in one glance and lets any client build the "your listings are live but nobody can
reach you" banner that this product currently cannot render at all.

---

## 6. Diff vs AUDIT3 — what the July waves actually closed

| AUDIT3 finding | Status now | Evidence |
|---|---|---|
| `[BLOCKER]` contact-reveal dead end: no profile contact DTO; quota burnt on zero-channel sellers | **FIXED-VERIFIED** (both halves) | `dto/identity.dto.ts:143-176` adds all four fields; `listing.service.ts:597-602` returns `NO_CHANNELS` **before** `enforceRevealRateLimit` — nothing charged, written or emitted. The *journey* gap survives as C1/M5. |
| `[MAJOR]` favorites: no module, no flow | **FIXED-VERIFIED at module level** | `modules/favorite/*` built, own-scope, idempotent, OfferingRef seam. View quality is the new M4. |
| `[MAJOR]` saved-search built with no alert loop | **FIXED-VERIFIED** | H4: `SavedSearchMatchConsumer` + per-pair idempotency + localized title. Control/visibility gaps are the new M7. |
| `[CRITICAL]` ownership transfer built with no flow | **FIXED-VERIFIED in the API** | full lifecycle + `terminalReason` + actor display names (`transfer.service.ts:818-843`). Best-shaped domain in the product. Residual: M8. |
| `[MAJOR]` account deactivate "reactivate later" contradicts the SM | **REFUTED / INVERTED** | code now implements 30-day recovery (`recovery.service.ts:25,124-136`) → `user_state_machine.md:63-64` is the stale artefact, not `user-flows.md:29`. Fix the SM (+ `docsRU`). |
| `[MAJOR]` EXPIRED→DRAFT renew drift | **CONFIRMED, untouched** | M1 above. |
| `[MAJOR]` no buyer-facing report affordance | **PARTIALLY FIXED** | `POST /content-reports` exists; the *return* half does not → M2. |
| `[MAJOR]` only happy paths; no empty/error/loading states specified | **CONFIRMED** | §5 — the API-side gaps are now enumerated with samples; the doc work (`user-flows.md` §6.2/§8.1 + `docsRU`) is still owed. |

---

## 7. Acceptance probes (re-runnable, for reviewer-qa)

1. `grep -c 'subjectType\|subjectId\|deepLink' backend/src/modules/notification/dto/notification.dto.ts` → **0** today; **> 0** closes B1.
2. `psql -Xc "SELECT count(*) FROM notification_logs n JOIN notification_templates t ON t.id=n.template_id WHERE t.name LIKE 'listing_%' AND n.content ~ '«[0-9a-f]{8}-'"` → **447** today; **0** closes B2.
3. `grep -ri appeal backend/src/ docs/03-architecture/api-contracts/` → **0 hits** today; while it is 0, `user_state_machine.md:16,48` must not promise an appeal (C2).
4. `grep -c 'showPhone\|contactReachable' backend/src/modules/identity/user-profile.util.ts` → **0** today; **> 0** closes C1.
5. `grep -c "type: 'about:blank'" backend/src/lib/http/problem.filter.ts` → **1** today; a per-code `type` URI closes the first third of M6.
6. `grep -n 'status' backend/src/modules/listing/dto/listing.dto.ts | grep ListingListQuery` → absent today; a `status` filter closes half of M3.

## 8. Open questions (owner / architect — not mine to decide)

1. **C2 shape:** should REJECT become recoverable (→ DRAFT), or stay terminal with an explicit
   "duplicate to new draft"? This is a moderation-policy call with an anti-abuse dimension
   (endless resubmission), not a pure UX call → **architect + security**.
2. **M6 scope:** localizing 47 error codes is a copy project, not a code change. Do we localize
   all of them, or only the ~15 that a non-operator can actually reach? I recommend the latter
   first, with a generated problem-code page as the artefact.
3. **M5 seller-notify:** notifying a seller that "someone tried to reach you" reveals demand
   signal — is that a plain product feature, or does it belong behind the (deferred) monetization
   line? → **owner / finance**, before I design the flow.
4. **C1 masking:** should `GET /me` return the contact phone masked or in full? Full is friendlier
   for a settings screen; masked is safer against session theft → **security**.

---

*Deliverables still owed by this lane once the above are decided: the notification-loop flow
(`docs/05-ui-ux/user-flows.md` + `docsRU`), the six-state spec for every screen touched here
(default/empty/loading/error/success/permission-denied), the RU/EN error-copy table, and the
review-lifecycle flow before the reputation behaviour slice opens (§3.5).*
