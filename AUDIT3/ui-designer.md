# ZooLink HYPER² Audit — Round 3 · ui-designer (visual / interaction / forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) · **Pairs with:** psychologist, ux-designer.
**Method:** independent forward-compat + UI-craft pass over the *design-contract surface* (no built UI), THEN diff vs `AUDIT2/ui-designer.md`.

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line/artifact → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ state-coverage · consistency · a11y · forward-compat · cognitive-load · trust · perceived-perf.

> **Verified reality (independently re-checked, 2026-07-02):** the UI-design surface is UNCHANGED since round 2.
> `docs/05-ui-ux/wireframes/` is **still empty**; the only UI artifacts are `docs/05-ui-ux/user-flows.md` (+RU mirror,
> textual behaviour), `docs/02-requirements/nfr/accessibility.md` (WCAG-AA checklist deferred to frontend-DoD), and
> `docs/specs/08-frontend-architecture.md` (folder/layer plan, ADR-0001 stack = React+TS+Vite+Tailwind+Headless UI).
> **No design tokens, no design system, no hi-fi components, no state matrices, no UI-string catalog.** Grep for
> "skeleton / optimistic / progressive" in the a11y + frontend-arch specs returns **nothing**. Because no artifact
> changed between rounds, round-3 is honestly a **confirmation pass** on round-2's 17 findings + a set of **NEW**
> UI-craft gaps my independent lens surfaced (imagery/upload, carousel/LCP, two-market visual tone, progressive-role,
> pending-too-long). Forward-compat **data** seams verified present: ADR-0014 (offering-supertype), ADR-0015
> (market_scope), ADR-0016 (provider-model) all exist; `future-features.md` confirms find-nearby map/list toggle (157),
> unified provider profile (169), progressive JIT roles (167), and the growth top-risk "грумер рядом: 0 результатов" (199).

---

## 🔴 Headline findings (independently re-derived)

`[CRITICAL][state-coverage][CONFIRMED] docs/05-ui-ux/user-flows.md:~133 (contact-reveal empty result) → the Phase-1 empty-channels reveal (channels: {}) has no designed empty-state; it renders as a blank/broken card AFTER the user spent a reveal quota — worst-possible trust moment. Contact-exchange still unimplemented (CLAUDE.md migration 0028: "contact-exchange=sub-wave C deferred"), so this is live. → specify a distinct, reassuring empty-state (RU+EN copy "Продавец не открыл контакты", icon, no-dead-end CTA e.g. "сохранить / вернуться к поиску"), visually separate from 429/network-error; do NOT consume quota on empty (route quota fix → backend-engineer).`

`[CRITICAL][forward-compat][CONFIRMED] docs/specs/08-frontend-architecture.md:112-117 → frontend features hardcode pet-marketplace + livestock-marketplace as siblings; the only specified card is animal-listing-shaped (user-flows.md:114-122). ADR-0014/0015/0016 + future-features.md commit the platform to service/product/consultation offerings, provider profiles, and a map/list toggle — NONE reserved at the UI layer. → introduce a polymorphic `OfferingCard` (variant slots: media, title, price/terms, geo-badge, market_scope, status, actor/verification badges) + a `discovery` feature rendering animal|service|product|consultation, BEFORE the component library is built. Building animal-shaped now = guaranteed Stage-1 redesign.`

`[CRITICAL][consistency][CONFIRMED] docs/05-ui-ux/wireframes/ (empty) → no design tokens / single visual source of truth exists; every color/spacing/type/radius/badge/motion decision is unanchored, and WCAG contrast is unverifiable. → author a design-tokens file (color incl. semantic status roles + state variants; type scale; spacing; radius; elevation; z-index; motion durations/easing incl. reduced-motion) BEFORE components, so consistency and contrast are structural.`

---

## Component & state coverage

`[MAJOR][state-coverage][CONFIRMED] docs/specs/08-frontend-architecture.md:88 (UC-FE-05) → "engaging empty states" named only as aspiration; no per-screen default/loading/empty/error/success matrix for any surface → produce a state matrix per screen; minimum: search-results, my-listings, my-animals, contact-reveal, moderation-queue, analytics.`

`[MAJOR][state-coverage][CONFIRMED] docs/specs/07-geo-search-service.md → zero-results-in-radius has no UI empty-state; §6.2 (user-flows.md:114) specifies only the populated card list. This empty-state IS the retention promise (growth top-risk "грумер рядом: 0 результатов", future-features.md:199). → design a zero-results state with widen-radius / clear-filters recovery. (EN geo-spec line ref from round-2 not re-locatable by grep → `требует ручной проверки` on exact line; gap itself confirmed.)`

`[MAJOR][perceived-perf][CONFIRMED] docs/02-requirements/nfr/accessibility.md + 08-frontend-architecture.md:54 → grep confirms skeleton / optimistic-UI / progressive-image loading are ENTIRELY absent; only "loading indicators" (spinners) mentioned. This is the core of "плавность/отзывчивость". → specify card-list skeletons + optimistic UI for submit/mark-sold/save-search + lazy image fade-in.`

`[MAJOR][state-coverage][CONFIRMED] docs/specs/error_handling/standard_error_format.md:30,128 → error.message is a single "suitable for display" string localized only by Accept-Language; there is NO error.code→friendly-localized-UI-copy catalog, so raw/generic backend text leaks into the RU UI → build an error-code→localized-message catalog (RU+EN) with recovery text + a generic error-boundary fallback state.`

## Imagery, upload & carousel — NEW (independent UI-craft lens; round 2 omitted media entirely)

`[MAJOR][state-coverage][NEW] docs/05-ui-ux/user-flows.md:57 (photos via pre-signed URLs; pet min 1 / livestock min 3) → the photo-UPLOAD flow — the single most failure-prone, latency-heavy MVP interaction — has zero UI spec: no uploading/progress, per-file failed-upload+retry, reorder/set-cover, min-count-not-met validation, or client-side compression budget. Pre-signed direct-to-S3 upload is exactly where perceived-perf breaks. → specify an upload component with per-image progress, failed/retry, drag-reorder, cover-photo selection, and an image size/format budget.`

`[MAJOR][consistency][NEW] docs/05-ui-ux/user-flows.md:6.3 (photo carousel) + 6.2 (thumbnail) → animal photos are the hero content but there is NO photo-treatment spec: card thumbnails and detail carousel will receive wildly varied aspect ratios/resolutions/orientations with no defined crop/fit/letterbox rule, breaking the grid rhythm and hierarchy. → define a canonical aspect ratio + object-fit/crop rule + placeholder/blur-up for card media and a carousel component (swipe, dot indicators, keyboard, lazy per-slide).`

`[MINOR][perceived-perf][NEW] user-flows.md:6.2/6.3 → LCP on both the results grid and the detail page is the first/cover image; no priority-load / eager-first-image / low-quality-placeholder rule is specified, so perceived load fights the NFR-PERF <3s-on-3G target (08-frontend-architecture.md:41). → mark cover/first image high-priority, lazy the rest, blur-up placeholder from a tiny inline preview.`

## Consistency (tokens, labels, badges, vocabulary)

`[MAJOR][cognitive-load][CONFIRMED] docs/05-ui-ux/user-flows.md:62,5.2 → two coupled status fields (status: DRAFT/PENDING_MODERATION/ACTIVE/SOLD/EXPIRED/DEACTIVATED + moderation_status: PENDING/APPROVED/CHANGES_REQUESTED/REJECTED) with a P0 cross-invariant; presenting both raw = high load for a mass-market seller → design ONE user-facing status vocabulary (single badge per listing: "На модерации"/"Нужны правки"/"Опубликовано"/"Продано") + a (status,moderation_status)→badge mapping table; co-review wording with psychologist.`

`[MAJOR][consistency][CONFIRMED] whole repo → no UI-chrome i18n key catalog; localization_specification covers only JSONB user-content. → establish a UI-string i18n catalog with enforced RU↔EN parity for every label/button/status/empty-state/error (same EN-canon+RU-mirror guarantee as docs).`

`[MAJOR][trust][CONFIRMED] docs/05-ui-ux/user-flows.md:121 → "Verified Breeder" badge is named with no backend verification source (no reviews/verification exist) → do NOT ship a verified/verification badge until the backend seam exists (false trust signal); spec only data-backed badges (vaccination-from-record, org-from-org-domain) and reserve a badge component that reads a typed source.`

`[MAJOR][consistency][CONFIRMED] docs/05-ui-ux/user-flows.md:57 → UI promises price "число / бесплатно / договорная, часто с единицей", but data holds only integer priceCents (GAP-BA-001); the price component cannot render "договорная за голову" → add field (backend) or correct UI copy; do not design a control the contract can't populate. `требует ручной проверки` on final field decision.`

`[MAJOR][trust][CONFIRMED] docs/04-decisions/0011-agent-principal-actor-model.md → actor {actor_id, principal_type} is in the contract (moderation/audit/admin) but no UI spec for the actor/"decided by AI" badge and no human-override affordance on moderation screens (user-flows §5,§9) → reserve an actor-badge component (HUMAN default / AGENT variant) + human-override control on operator surfaces (ADR-0011/0006). End-user visibility = open owner decision; data present regardless.`

`[MAJOR][consistency][NEW] ADR-0002 + charter (warm/pet vs credible/livestock, never blur) → the design system must express TWO distinct market tones from ONE token set, but no strategy exists for how tokens carry a per-market brand tone (accent/imagery/density) without forking into two hand-built themes or, worse, blurring the markets → define a market-scope theming seam in the tokens layer (shared base + per-market accent/tone tokens) so pet↔livestock stay visually distinct and consistent, resolved the same way as light/dark.`

## Accessibility (WCAG 2.1 AA)

`[MAJOR][a11y][CONFIRMED] docs/02-requirements/nfr/accessibility.md:8 → thorough WCAG-AA checklist but self-declared aspirational/deferred; without tokens, contrast (4.5:1 / 3:1 / focus 3:1) is unverifiable and 44×44 targets have no component sizing → bind the checklist to concrete tokens + per-component specs; keep in the frontend CI gate (axe/Lighthouse).`

`[MAJOR][a11y][CONFIRMED] docs/02-requirements/nfr/accessibility.md:~159 → "color is not the only signal" is stated but the status/badge system risks being color-only → mandate icon+text on every status/actor/verification badge; verify against deuteranopia/protanopia.`

`[MINOR][a11y][CONFIRMED] docs/02-requirements/nfr/accessibility.md:~141 → aria-live not named for the critical dynamic moments → name aria-live regions for reveal-result, submit-errors, zero-results.`

## Forward-compat (design-system polymorphism)

`[MAJOR][forward-compat][CONFIRMED] docs/05-ui-ux/user-flows.md:98 → filters specified only for animal attributes; service ("открыто сейчас", rating, service-type) and product (unit, subscription) filters have no reserved abstraction → design a polymorphic filter-panel driven by offering-type (find-nearby is the primary Stage-1 entry, future-features.md:157/194).`

`[MAJOR][forward-compat][CONFIRMED] docs/specs/08-frontend-architecture.md:117 → no provider/organization-profile feature, yet future-features.md:169 makes "единый профиль провайдера" (offerings+reviews+hours+verification) an apex comfort requirement → reserve a provider-profile shell (tabbed: offerings/reviews/hours/verification) as a composition seam, even if only listings renders in MVP.`

`[MINOR][forward-compat][NEW] docsRU/01-discovery/future-features.md:167 → progressive JIT roles (покупатель→продавец→провайдер→продавец товаров, role activates on first action, no re-registration) has no UI seam; if the nav/account/create surfaces are built role-static now, the just-in-time role-activation moment forces a nav+IA redesign → reserve a capability-gated nav/account shell that reveals seller/provider affordances progressively (co-own with ux-designer).`

`[MINOR][state-coverage][NEW] docs/05-ui-ux/user-flows.md:5.3 (SLA TBD, escalation keeps PENDING) → a listing can sit in "На модерации" indefinitely with no user-visible progress; no pending-too-long reassurance state is specified → after the SLA window, show a reassuring "проверяем дольше обычного" micro-state rather than an unchanged static badge (perceived-responsiveness + anti-anxiety; co-review psychologist).`

`[INFO][forward-compat][CONFIRMED] future-features.md:170 → booking lifecycle UI (заявка→подтверждено→выполнено→отзыв) is a future state-machine surface → note for ADR-D sequencing so the status-badge vocabulary designed now absorbs booking states without a second vocabulary.`

`[INFO][forward-compat][CONFIRMED] future-features.md:206 → "лайфсайкл животного как хребет" implies Animal-detail is a future hub, not a leaf → keep the animal-profile layout extensible (section slots), not a fixed listing-attached view.`

## Positive / solid

- Behavioural flows (`user-flows.md`) remain aligned to the canonical state machine (3-valued moderation, SOLD-not-COMPLETED, two-field status, reveal preconditions) — the behaviour the UI must dress is trustworthy.
- Accessibility NFR is thorough and *honestly* deferred (tracked-not-faked, GAP-014); the only gap is tokens+component specs to make it enforceable.
- Localization data-model (JSONB per-field, fallback, GIN) is well-specified for content; gap is only UI-chrome strings.
- Forward-compat **data** seams (ADR-0014/0015/0016/0011) exist and verified — the design layer just has to mirror them, which is cheap now.

---

## Diff vs AUDIT2 (round 2)

**Reason for high CONFIRMED count:** no UI artifact changed between rounds (same HEAD `4533e78`, wireframes still empty); round-2's 17 findings independently re-verify as still-true, and I add NEW UI-craft gaps round 2 did not cover.

| Status | Count | Items |
|---|---|---|
| **CONFIRMED** | 14 | contact-reveal empty-state; polymorphic OfferingCard/discovery; design-tokens; per-screen state matrix; zero-results; perceived-perf skeletons/optimistic; error-code→copy catalog; single status vocabulary; UI-string i18n parity; verified-badge un-backed; priceCents mismatch; actor-badge/human-override; a11y tokens-binding; a11y color-only; aria-live; polymorphic filter-panel; provider-profile shell; booking-lifecycle INFO; animal-hub INFO |
| **NEW** | 6 | photo-upload flow states; photo-treatment/carousel consistency; cover-image LCP priority; two-market visual-tone token seam; progressive JIT-role nav seam; pending-too-long moderation micro-state |
| **REFUTED** | 0 | — |
| **SEV-CHG** | 0 | — (all round-2 severities hold; nothing fixed to downgrade, nothing worsened to upgrade) |

*(CONFIRMED collapses a few round-2 line-items into single rows; underlying probe coverage of all 17 round-2 findings is preserved.)*

**Net new probes (add to round-2's 17):**
18. **[state-coverage] Photo-upload has full state spec** — uploading/progress, per-file failed+retry, reorder, cover-select, min-count validation. *(Today: fails.)*
19. **[consistency] Photo-treatment rule** — canonical aspect ratio + object-fit + blur-up placeholder for card media and carousel. *(Today: fails.)*
20. **[perceived-perf] Cover/first image is priority-loaded**, rest lazy, blur-up placeholder. *(Today: fails.)*
21. **[consistency] Two-market tone seam in tokens** — shared base + per-market accent/tone, resolved like light/dark; pet↔livestock stay distinct, never blurred. *(Today: fails.)*
22. **[forward-compat] Progressive-role nav seam** — capability-gated nav/account shell reveals seller/provider affordances JIT. *(Today: fails.)*
23. **[state-coverage] Pending-too-long moderation micro-state** exists after SLA window. *(Today: fails.)*

*Probe count: **23** (17 confirmed + 6 new).*

*Scope note:* no built UI exists; all findings are against design-contract artifacts + what the data contracts imply. I modified no product code or docs — this file is my sole output. Items depending on unbuilt frontend or open owner decisions are marked `требует ручной проверки` where noted.
