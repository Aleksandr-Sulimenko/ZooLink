# ZooLink HYPER² Forward-Compat RE-AUDIT — AUDIT3 (round 2, 2026-07-02)

**Scope:** independent re-derivation by all 18 specialist lanes (Phase 1 `active-user` needs-first;
Phase 2 the 16 specialists + `psychologist`, forward-compat/anti-rewrite lens, each with test probes;
Phase 3 hyper-test; Phase 4 this synthesis) — **then reconciled** against round 1 (`AUDIT2_FORWARD_COMPAT.md`
+ `AUDIT2/*.md`). Branch `backend`, HEAD `4533e78`, **NOT pushed**. Baseline **verified real**:
**450 unit / 243 e2e pass + 1 intentional BLOCKER-RED + 11 todo**, zero flakes. Full per-lane findings +
probes: `AUDIT3/<role>.md`; execution proof: `AUDIT3/PHASE3_HYPERTEST.md`.

> **Headline (round 2 sharpens round 1, doesn't overturn it):** the CORE stays sound and secure
> (IDOR/object-authz exemplary — the 4 newest modules re-verified clean; event-envelope carries
> `market`+`schemaVersion` in-tx; PII crypto real; migrations CI-gated 0001–0028; money in minor-units;
> monolith absorbs the ecosystem with no re-platform). **Two things graduate from round 1:**
> **(1) the "dead marketplace" is not one bug — it is a *systemic pattern*.** The same shape
> "schema/contract form present, behaviour absent, hidden behind a green fixture" recurs across
> **seven** surfaces, of which the whole event/notification layer is the worst: **the outbox has zero
> registered consumers**, so every event round 1 celebrated as "now built" is produced and
> marked-processed with **no side-effect**. **(2) two security seams round 1 rated MAJOR now carry
> concrete CRITICAL exploit chains** (dev-token account-takeover; stored-XSS → refresh-token exfil).

---

## Round 1 ↔ Round 2 reconciliation — per-lane diff
Counts are each lane's self-reported diff vs its `AUDIT2/<role>.md`.

| Lane | NEW | CONFIRMED | REFUTED | SEV-CHG | Sharpest round-2 delta |
|---|---|---|---|---|---|
| active-user | ~5 | 6 | 0 | 3 | **outbox 0 consumers** = whole event layer dead; no native photo upload; transfer counterparty undiscoverable |
| architect | 5 | 8 | 1 | 1 | ADR-0018 raw join is **3 sites** (queue-CTE non-decomposable) → refactor **CRITICAL + partially circular** with 0014; 0014 self-contradicts on timing |
| backend-engineer | 5 | 9 | 0 | 1 | the dead-feature pattern is **systemic**: org onboarding, notification, outbox, S3 upload, favorites all "form-not-behaviour" |
| security | 4 | 12 | 0 | **2→CRIT** | dev-token **fail-open → full ATO**; avatarUrl-XSS × refresh-in-body → ATO |
| reviewer-qa | 5 | 8 | 1 | 1 | green suite masks **5** dead surfaces; outbox = write-only sink; baseline re-counted 243 e2e |
| alpha-analyst | 6 | 4 | 1 | 1 | GAP-BA-001 livestock `price_or_terms` unbuildable; admin-api duplicate `/moderation` + dead paths |
| janitor | 4 | 10 | 0 | 1 | market-enum split already ×4; migration-range doc says 0022 vs repo 0028 |
| legal | 1 | 7 | 1 | 2 | contact-reveal is a **LIVE ФЗ-152 ст.10.1** distribution on pre-checked default (MAJOR→CRIT) |
| devops | 5 | 13 | 2 | 1 | `prisma migrate deploy` **still in repo** (perf-tests.yml + docs) → ADR-0007 violation alive |
| data-analyst | 2 | 10 | 1 | 1 | north-star ~18% but **multiplicatively 0%** today; `views` MAJOR→CRIT (only irrecoverable-now) |
| finance | 4 | 6 | 0 | 0 | contact-reveal billing-unit broken (quota burns + phantom row + lead event on empty); `feature_toggles` has no market axis |
| growth | 2 | 4 | 0 | 1 | empty reveal is the **activation** blocker (not a north-star symptom); saved-search = dead return loop |
| senior-business-analyst | 4 | 7 | 0 | 2 | silent-dropped BRs: favorites, contact-write-path, notification dispatch, transfer counterparty |
| ux-designer | 4 | 15 | 1 | 1 | 7 comfort pillars unreserved as UX structure → services/goods = redesign; flow↔state-machine contradiction |
| ui-designer | 6 | 14 | 0 | 0 | photo-upload flow = most fragile MVP interaction, zero state spec; no design tokens |
| psychologist | 2 | 8 | 1 | 1 | transfer expiry lazy-on-read → 72h dies in silence both sides; reveal quota `incr` before empty check |
| frontend-engineer | 6 | 10 | 2 | 3 | refresh-in-body = 3-way contradiction; contract alignment **improved** (Problem/PageMeta/roles across 13) |
| doc-keeper | 2 | 8 | 1 | 1 | ADR status drift (memo Proposed vs files Accepted for 0016/0019); `contact_phone` in schema not in ERD |

**No confirmed round-1 finding was proven wrong on its merits** — the REFUTED column is corrections of
round-1's *evidence* (a controller that does exist, a residual that was already seeded), not reversals
of a real defect. Details below.

---

## The dominant round-2 theme: a *cluster* of dead features (form-present, behaviour-absent)
Round 1 found this once (contact_reveals). Round 2's instruction was "assume the green suite masks more"
— and it does. Each was independently re-derived by tracing the **writer** of every table and the
**consumer** of every event; each is masked by a fixture that seeds state a real user can never reach.

| # | Dead surface | Evidence | Masking test | Verdict |
|---|---|---|---|---|
| 1 | **contact channels** (writer) | `identity.dto.ts:113` no contact fields; register discards plaintext phone (HMAC only); `listing.service.ts:459` reveal→`{}` | `listing-contact-sold.e2e` fixture seeds phone | 🔴 **BLOCKER** (PROVEN RED) |
| 2 | **outbox consumers = 0** | `outbox.relay.ts` no registered consumers; every event produced + marked-processed, no side-effect; late consumer can't replay (`processed_at IS NULL` filter) | `moderation.e2e:194,219` asserts row only; `outbox.relay.spec` codifies "no consumer→processed" | 🔴 **CRITICAL** (event/analytics layer hollow) |
| 3 | **notification module** | templates seeded, `notification_logs` only null'd, no sender/dispatcher | none — surface has no test | 🔴 **CRITICAL** (transfer/moderation happen in silence) |
| 4 | **native photo upload** | S3 `presignUpload/Download` wired to **zero** controllers; photo = arbitrary external URL (`@IsUrl require_tld:false`) | `listing.e2e:71` uses URL string | 🟠 **MAJOR** (+SSRF/bait-switch → security) |
| 5 | **saved-search matcher** | `saved-search.controller` CRUD exists (round-1 wrongly said "no controller") but **no matcher/notifier** anywhere | `saved-search.e2e` CRUD-only | 🟠 **MAJOR** (only retention loop is dead) |
| 6 | **favorites** | table + CASL ability + contract + 3 canon docs, **0% controller code, no GAP marker** | none | ⚠️ **conflict-adjudicated → MAJOR** (see below) |
| 7 | **org onboarding** | `organizations/organization_users/branches` authz **reads** membership, no **writer**; org-admin path unreachable in prod | `transfer.e2e`/`org-membership.spec` fixtures seed directly | 🟠 **MAJOR** (org authz dangling) |

**Implication for the test suite:** before any P1/P2 build, replace the masking fixtures with honest
`register → act → observe` paths, and add outbox-**consumer** assertions — otherwise green keeps lying.

---

## Security escalations (round 1 MAJOR/MINOR → round 2 CRITICAL, with chains)
1. **dev-token fail-open → full account takeover** `env.validation.ts:8` defaults `NODE_ENV='development'`
   → in prod without an explicit `NODE_ENV`, `POST /auth/dev-token` stays live (fail-**open** master key)
   → any seller's `userId` is public in a listing (`listing.service.ts:1045`) → mint their token → mint an
   operator's → `manage all`. **Fix:** explicit `ENABLE_DEV_TOKEN` default-false; drop the NODE_ENV default.
2. **stored-XSS → refresh-token exfil → ATO** `avatarUrl` validated `@IsString()` only, no `@IsUrl`
   (`identity.dto.ts:47/94/125`; contract `format:uri` not enforced, `javascript:`/`<img onerror>` pass)
   → renders in the future admin/FE → steals the `refreshToken` that is returned **in the JSON body**
   (`auth.controller.ts:33`, `TokenPairDto`; contravenes `API_CONVENTIONS.md:33` requiring HttpOnly cookie)
   → account takeover, escalatable to operator. Latent until FE, but both halves are in code+contract now.
   **Fix:** `@IsUrl` allowlist on avatar; refresh-token → HttpOnly cookie.

**Honestly NOT escalated** (security's own call): refresh-rotation TOCTOU (needs an already-stolen token +
a race) and JWT algs-pin (symmetric secret mitigates) stay MINOR. **Outward GO/NO-GO: NO-GO** until
dev-token is fail-closed.

---

## Refutations & corrections (round 2 fixing round 1's evidence)
- **saved-search "contract-only, no controller"** → **controller IS built & mounted** (GET/POST/DELETE);
  the real defect is the missing matcher/notifier. *[alpha, frontend]*
- **"`prisma migrate deploy` removed everywhere"** → **still present** in `performance-tests.yml:57` +
  `docs/specs/09-testing-strategy.md:220` (EN+RU) → ADR-0007 violation is alive. *[devops]*
- **"event envelope can't separate pet/livestock"** → it **does** carry `market` in-tx → analytics are
  market-separable. *[data-analyst]*
- **"`/metrics @Public` is a leak"** → internal-only; Caddy does not route it externally. *[devops]*
  (conflict with security — adjudicated MINOR/harden, below.)
- **"`prohibited_species` not seeded"** → **is** seeded (`database_schema.sql:1339`). *[legal]*
- **"`role_in_org` duplicate definition"** → resolved. *[architect]*
- **"matching offset bug"** → `offset=0` correct. *[frontend]*
- **"roach-motel / no exit"** → self-service `eraseMe` + deactivate/reactivate exist. *[psychologist]*
- **"RU mirror stale / yaml stuck"** → EN↔RU parity healthy (176/176; 13 contracts aligned). *[ux, frontend]*
- **contact-reveal "inert forward-compat form"** → the **code path is LIVE** (decrypts + distributes when
  `show_phone` truthy, default `true`); only empty because no writer populates the column. This makes it a
  *latent live legal exposure* that arms the moment P1 lands. *[legal, frontend]*

---

## Conflicts adjudicated
1. **favorites severity** — active-user & SBA rated **CRITICAL** (MVP-promised in 3 canon docs + contract +
   CASL, 0% code, no GAP marker = a *silent drop*, which violates the apex "no requirement dropped
   silently"); doc-keeper rated **MINOR** (BR-016 is planned Phase-2-ish scope, not a regression).
   **Adjudication — MAJOR, split by axis:** the *silent-drop* is the real fault and is serious (must get an
   explicit GAP/deferral entry now — cheap, closes the apex-violation); the *build urgency* is low (it does
   not block the core buyer↔seller loop). Net action: **track it explicitly this round; build later.**
2. **`/metrics @Public`** — security MAJOR vs devops "internal-only, not routed". **Adjudication — MINOR/
   harden:** Caddy-not-routing is the live mitigation but is config-dependent; add a role-gate/internal
   guard as defence-in-depth. Not a launch blocker.
3. **Everything else converged** — unusually high cross-lane agreement, as in round 1.

---

## Forward-compat per-seam verdict — changes from round 1
| Seam | R1 | R2 | Change |
|---|---|---|---|
| **ADR-0018 cross-aggregate** (`marketOf` raw join) | REWRITE-RISK (1 site, bounded) | 🔴 **REWRITE-RISK — 3 sites + partially circular** | join at `listing.service.ts:627`, `moderation.service.ts:577` (verbatim dup) **and** the moderation-queue base-CTE `:189` which does **not** decompose to per-row `AnimalService` calls → clean fix = the ADR-0014 read-model → "0018 is 0014's prerequisite" is **partially circular** for list paths |
| **ADR-0014 Offering polymorphic** | RESERVE-NOW | 🟠 **RESERVE-NOW + self-contradiction** | ADR text: rule 2 "ships now" vs Impl Notes "not now"; `favorites-api.yaml:58 listingId` makes retrofit an API-breaking change too |
| **market_scope / monetization_type / roles[] / geo_anchor / value-event** | RESERVE-NOW (grep=0) | 🟠 **RESERVE-NOW — grep=0 re-confirmed** | independently re-verified absent in code AND schema; each given a cheap seam-shape in `AUDIT3/architect.md` + `finance.md` |
| **`views` source** | part of value-event RESERVE-NOW | 🔴 **CRITICAL / irrecoverable-now** | the only live surface whose history cannot be backfilled — the single non-negotiable reserve-now |
| **ADR-0019 PII / infra-monolith** | SAFE (except RF-residency) | ✅ SAFE unchanged | RF-residency (ADR-0017) remains the sole structural infra blocker |

**Net forward-compat verdict (unchanged in direction, firmer in detail):** proceeding on the ecosystem is
safe **iff** (a) ADR-0018 is resolved first — now known to be a wider, partly-circular refactor that should
be done **via the 0014 read-model**, not a quick route-through-AnimalService, and (b) the RESERVE-NOW seam
pack is laid before/with the first non-animal offering. The window is still open and cheap. The dead-feature
cluster (P1) is independent of the ecosystem and is the gating *product* fact.

---

## Unified prioritized action list (round 1 + round 2 merged)
**P0 — launch gates (owner/legal; not build blockers):** publish offer/ToS/privacy/consent (DRAFTs exist,
honestly marked) + РКН notification (ст.22) + designate ответственный (ст.22.1) + entity/counsel;
**ADR-0017 RF data-residency** region-pin + fail-on-non-RF CI/deploy guardrail (the sole structural infra
blocker; cheap first cut = zod `.refine()` on `S3_REGION`).

**P1 — make the built product actually work (the dead-feature cluster):**
1. **contact-channel writer** on `PATCH /me` (contactPhone/contactTelegram/showPhone/showTelegram) +
   **default `show_phone` to explicit opt-in** (kills the ФЗ-152/dark-pattern finding) + **delete the
   masking fixture** so the suite tells the truth. NB: plaintext phone is discarded at register, so the
   writer must accept it explicitly — cannot be back-derived from login.
2. **a notification/outbox consumer** so transfer & moderation outcomes aren't silent (register at least one
   real consumer; without it the whole event layer is a write-only sink).
3. **contact-reveal billing-unit fix:** count channels **first**, don't burn quota / write a row / emit a
   lead event on an empty reveal; add `(viewer_id, listing_id)` dedup; re-key quota per-seller/account-age.
4. **security seams:** dev-token fail-**closed** (`ENABLE_DEV_TOKEN`), refresh-token → HttpOnly cookie,
   `avatarUrl @IsUrl` allowlist, photo-URL → own-S3 host allowlist, JWT `algorithms:['HS256']`, animal
   `getById` 403→404, gate/guard `/metrics` (defence-in-depth).
5. **ownership-transfer counterparty discovery** (a safe user-lookup) — transfer is unusable without it.

**P2 — anti-rewrite form-now seams:** `OfferingRef{type,id}` across favorites/saved-search/discovery/
moderation/events; `market_scope` column; `monetization_type`; multi-role `roles[]` + JIT activation;
`geo_anchor` + reconcile the two near-me endpoints; unified value-event marker + **`views` capture (do this
first — irrecoverable)**; **route `marketOf` via the ADR-0014 read-model + flip ADR-0018/0016/0019 status**;
a shared authz-scope enforcement point; a versioned consent-record model (ФЗ-38); livestock `price_or_terms`
(GAP-BA-001) so half the platform can list.

**P3 — structural debt + docs:** traceability matrix refresh (stale vs Jul-1); migration-range header
0022→0028 (`CLAUDE.md:19`, `engineering-guide.md:25`); ERD add `contact_phone`; admin-api duplicate
`/moderation` + dead paths; `_common.yaml`; ecosystem vision into the **requirements canon** + north-star as
a documented metric; UX comfort-IA + polymorphic OfferingCard + empty-states (reveal / "0 грумеров рядом");
photo-upload state spec; **track favorites explicitly (close the silent drop)**.

**P4 — hygiene:** dedup `SLA_TARGET_SECONDS`×2 / `toBool`×5 / `MARKETS`×4 / `LocalizedStringDto`×3;
`git rm --cached .idea`; rotate `.env` secret; rename the space-in-filename file; Semgrep/Trivy → blocking;
generate the Kysely `DB` types.

---

## Phase-3 proof (see `AUDIT3/PHASE3_HYPERTEST.md`)
Baseline **450 unit / 243 e2e pass + 1 BLOCKER-RED + 11 todo**, verified by an independent full run. The
BLOCKER RED floor **held** (real seller→buyer reveal = `{}`), confirming P1 was not built (owner-paused).
6 abuse/security proofs reproduce GREEN. The ~per-lane new probes (reviewer-qa's 32-case plan + each lane's
probes) are the executable backlog for the owner's dedicated "причёсывание тестером" pass — **not**
implemented this round (delegates stayed read-only; no `src`/existing tests touched).

*Round-2 delegates modified no product code and committed nothing. Tree changes are the `AUDIT3/*` docs +
this synthesis. Commit only on the owner's explicit request.*
