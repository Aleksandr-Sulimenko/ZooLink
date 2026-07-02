# ZooLink HYPER Audit — Phase 2 · ui-designer (visual / interaction / forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Pairs with:** psychologist (trust/cognitive-load).
**Method:** audited the *design contract surface* only — this is a backend-first repo with **no built UI**. I judged
what the existing artifacts (user-flows, accessibility NFR, frontend-architecture spec, error/localization specs, ADRs)
specify vs leave aspirational, and what the data contracts + vocabulary *imply* the UI must render and reserve.

Finding format: `[severity][criterion][ui] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ state-coverage · consistency · a11y · forward-compat · cognitive-load · trust.

> **UI-artifact maturity (verified reality):** There is **no design system, no design tokens, no hi-fi component
> library, no wireframes** (`docs/05-ui-ux/wireframes/` is an **empty directory**). The entire UI-design surface is:
> (1) `docs/05-ui-ux/user-flows.md` — textual behavioural flows, zero visual/state spec; (2) `docs/02-requirements/nfr/accessibility.md`
> — a thorough WCAG-2.1-AA checklist **explicitly deferred to the frontend-phase DoD** (self-described "aspirational,
> tracked-not-built"); (3) `docs/specs/08-frontend-architecture.md` — folder/layer structure, no visuals. Localized
> UI-chrome strings, status-badge specs, and per-component state matrices **do not exist**. This is honest for a
> backend stage — my findings therefore target **what the contracts imply the UI must render** and **what must be
> reserved now** so the design system is not born animal-listing-shaped.

---

## 🔴 Headline design findings

### A. The Phase-1 BLOCKER (contact-reveal empty channels) surfaces to the user as a broken card — and no empty-state UI is specified for it
`active-user.md` finding #1: every real contact-reveal returns `channels: {}`. In UI terms the user taps "Показать
контакт", burns a quota, and the result panel has **nothing to render**. `user-flows.md:135` documents the empty-result
*case* ("раскрывать нечего / empty result") but **no screen, no empty-state copy, no visual treatment** exists for it.
Absent a designed empty-state, the frontend will show a blank/broken card — the worst possible trust moment (post-tap,
post-quota-spend). This state needs a *first-class, reassuring* empty-state ("Продавец не открыл контакты" + a
non-dead-end next action), visually distinct from an error/network-failure state.

`[CRITICAL][state-coverage][ui] docs/05-ui-ux/user-flows.md:135 → the empty-channels contact-reveal outcome (Phase-1 BLOCKER) has no specified empty-state UI; it will render as a blank/broken card after the user spends a reveal quota → specify a distinct, reassuring empty-state (copy RU+EN, icon, no-dead-end CTA e.g. "сохранить в избранное / вернуться к поиску") separate from the 429/network-error state, and do NOT consume quota when channels are empty (route the quota fix to backend-engineer).`

### B. The design system, as specified, is animal-listing-shaped — it will not extend to services/products/providers/find-nearby without a redesign
The only card specified is the **animal-listing card** (`user-flows.md:115-122`: photo / species-breed / sex / age /
price / distance / breeder-badge). The frontend feature structure hardcodes `pet-marketplace` + `livestock-marketplace`
as sibling features with **no `discovery`/`offering`/`find-nearby` feature** (`08-frontend-architecture.md:112-117`).
Yet ADR-0014 (polymorphic Offering seam), ADR-0015 (`market_scope`), ADR-0016 (provider model) already commit the
platform to service-cards (no animal; hours, "открыто сейчас", rating, service-area), product-cards (price/unit,
reorder/subscription), provider-profiles, and a **map/list toggle** (`future-features.md:157`; `07-geo-search-service.md`).
**None of these is reserved at the UI layer.** The data layer has its forward-compat seams; the *design* layer has none
mirroring them. Building the card/list/detail components now against the animal shape = guaranteed redesign at Stage-1.

`[CRITICAL][forward-compat][ui] docs/specs/08-frontend-architecture.md:112 → frontend features hardcode pet-/livestock-marketplace and the only specified card is animal-listing-shaped (user-flows.md:115); no polymorphic OfferingCard, no provider-profile, no map/list toggle despite ADR-0014/0015/0016 committing to them → introduce a polymorphic `OfferingCard` abstraction (variant slots: media, title, price/terms, geo-badge, market_scope, status, actor/verification badges) + a `discovery` feature that renders animal|service|product|consultation, and reserve a map/list-toggle layout, BEFORE the component library is built.`

---

## Component & state coverage

`[MAJOR][state-coverage][ui] docs/specs/08-frontend-architecture.md:88 → "engaging empty states and error messages" is named only as an aspiration (UC-FE-05); there is no per-screen state matrix (default/loading/empty/error/success) for any surface → produce a state matrix per screen; at minimum specify empty+error+loading for: search results, my-listings, my-animals, contact-reveal, moderation queue, analytics.`

`[MAJOR][state-coverage][ui] docs/specs/07-geo-search-service.md:68 → zero-results search ("нет результатов в радиусе") is flagged in the geo spec but has NO UI empty-state; §6.2 search-results (user-flows.md:114) specifies only the populated card list → design a zero-results state with a widen-radius / clear-filters recovery action (critical: the growth top-risk is "грумер рядом: 0 результатов", future-features.md:199 — this empty-state IS the retention promise).`

`[MAJOR][state-coverage][ui] docs/02-requirements/nfr/accessibility.md:319 → skeleton screens / optimistic UI / progressive image loading (perceived-performance, the core of "плавность/отзывчивость") are unspecified; only "loading indicators" (spinners) are mentioned (08-frontend-architecture.md:54) → specify skeleton placeholders for card lists + optimistic UI for submit/mark-sold/save-search + lazy image fade-in, so the app feels instant while the backend works.`

`[MAJOR][state-coverage][ui] docs/specs/error_handling/standard_error_format.md:16 → RFC-error `error.message` is a single string "suitable for display to users"; there is no mapping from error.code → localized, friendly UI copy, so raw backend messages (or English) will leak into the RU UI → build an error-code→localized-message catalog (RU+EN) with actionable recovery text, and specify a generic error-boundary fallback state.`

## Consistency (tokens, labels, badges, vocabulary)

`[CRITICAL][consistency][ui] docs/05-ui-ux/wireframes/ → no design tokens and no single visual source of truth exist (empty wireframes dir, no design-system doc); every color/spacing/type/radius/badge decision is unanchored → author a design-tokens file (color incl. semantic status roles, type scale, spacing, radius, elevation, motion durations/easing) BEFORE components, so consistency and WCAG contrast are structural not accidental.`

`[MAJOR][cognitive-load][ui] docs/05-ui-ux/user-flows.md:62 → the UI must expose TWO coupled status fields (lifecycle `status`: DRAFT/PENDING_MODERATION/ACTIVE/SOLD/EXPIRED/DEACTIVATED + `moderation_status`: PENDING/APPROVED/CHANGES_REQUESTED/REJECTED) with a P0 cross-invariant; presenting both raw = high cognitive load for a mass-market seller → design a SINGLE user-facing status vocabulary (one badge per listing that collapses the two fields into a human phrase, e.g. "На модерации" / "Нужны правки" / "Опубликовано" / "Продано"), with a status→badge mapping table; co-review wording with psychologist.`

`[MAJOR][consistency][ui] whole repo → status/badge/label RU+EN strings have NO catalog (grep for localized status labels returns nothing; localization_specification.md covers only JSONB *user-content*, not UI chrome) → establish a UI-string i18n key catalog with enforced RU↔EN parity (the doc-contract is EN-canon+RU-mirror; the running UI needs the same guarantee for every label, button, status, empty-state, and error).`

`[MAJOR][consistency][ui] docs/05-ui-ux/user-flows.md:121 → badges are named ("Проверенный заводчик", "Вакцинирован", org/branch badge) with no visual spec AND "Verified Breeder" has no backend (no verification/reviews exist per active-user.md) → do NOT ship a verification/verified-badge visual until the backend seam exists (would be a false trust signal); spec only badges backed by real data (vaccination-from-animal-record, org-from-org-domain-when-built), and reserve a badge component that reads a typed source.`

`[MAJOR][consistency][ui] docs/05-ui-ux/user-flows.md:57 → the UI promises price "число / бесплатно / договорная, часто с единицей измерения", but the data holds only integer `priceCents` (active-user.md GAP-BA-001) → the price component cannot render "договорная за голову"; either the field is added (backend) or the UI copy is corrected — do not design a control the contract can't populate. `требует ручной проверки` on final field decision.`

`[MAJOR][trust][ui] docs/04-decisions/0011-agent-principal-actor-model.md:164 → the actor "agent-badge" `{actor_id, principal_type}` shape is in the contract (moderation decisions, audit, admin actions) but there is no UI spec for the actor/"decided by AI" badge, and the moderation-queue screens (user-flows.md §5,§9) show no actor/human-override affordance → reserve an actor-badge component (HUMAN default, AGENT variant) on operator surfaces + a human-override control, so ADR-0011/ADR-0006 transparency is renderable when agents go live (owner-decision #5 on end-user visibility stays open — data is present regardless).`

## Accessibility (WCAG 2.1 AA)

`[MAJOR][a11y][ui] docs/02-requirements/nfr/accessibility.md:8 → the WCAG-2.1-AA requirement is comprehensive but self-declared aspirational / deferred to frontend-DoD; without design tokens, contrast ratios (4.5:1 text, 3:1 UI, focus 3:1) are unverifiable and touch-target 44×44 is a rule with no component sizing → bind the a11y checklist to concrete tokens + per-component specs (focus style, target size, SR label) so it is enforceable, not just referenced; keep it in the frontend CI gate (axe/Lighthouse, line 219).`

`[MAJOR][a11y][ui] docs/02-requirements/nfr/accessibility.md:159 → "color is not the only signal" is stated, but the status/badge system (finding above) risks being color-only (green=active/red=rejected) → mandate icon+text on every status badge and never rely on hue alone; verify against deuteranopia/protanopia in design review.`

`[MINOR][a11y][ui] docs/02-requirements/nfr/accessibility.md:141 → contact-reveal result + form errors + zero-results are dynamic content that must announce via aria-live; the spec lists live-regions generically but not for these specific critical moments → name the aria-live regions for reveal-result, submit-errors, and search-empty in the component specs.`

## Forward-compat (design-system polymorphism)

`[MAJOR][forward-compat][ui] docs/05-ui-ux/user-flows.md:98 → search/filters are specified only for animal attributes (species/breed/sex/age/radius/price); service filters ("открыто сейчас", rating, service-type, distance) and product filters (unit, subscription) have no reserved filter-panel abstraction → design a polymorphic filter-panel driven by offering-type so find-nearby (the primary Stage-1 entry point, future-features.md:168) does not force a filter redesign.`

`[MAJOR][forward-compat][ui] docs/specs/08-frontend-architecture.md:117 → there is no `provider-profile` / `organization-profile` feature or component, yet future-features.md:169 makes the "единый профиль провайдера" (services+products+listings+reviews+hours+verification) an apex comfort requirement → reserve a provider-profile shell (tabbed: offerings / reviews / hours / verification) now as a composition seam, even if only the listings tab renders in MVP.`

`[INFO][forward-compat][ui] docsRU/01-discovery/future-features.md:170 → the booking lifecycle UI (заявка→подтверждено→выполнено→отзыв with reminders + clear per-step status) is a whole future state-machine surface; note it for ADR-D sequencing so the status-badge system designed now can absorb booking states without a second vocabulary.`

`[INFO][forward-compat][ui] docsRU/01-discovery/future-features.md:206 → the "лайфсайкл животного как хребет" hub (vet history / food subscription / training progress on the Animal profile) implies the Animal-detail screen is a future hub, not a leaf → keep the animal-profile layout extensible (section slots) rather than a fixed listing-attached view.`

## Positive / solid

- Behavioural flows (`user-flows.md`) are aligned to the canonical state machine after the 2026-06-30 correction (3-valued moderation, SOLD-not-COMPLETED, two-field status, reveal preconditions) — the *behaviour* the UI must dress is trustworthy.
- Accessibility NFR is unusually thorough for this stage and is *honestly* deferred (tracked-not-dissolved, GAP-014) rather than faked-as-done — good discipline; my finding is only that it needs tokens+component specs to become enforceable.
- Localization data-model (JSONB per-field, fallback chain, GIN indexes) is well-specified for *content*; the gap is only UI-chrome strings.
- The forward-compat **data** seams (ADR-0014/0015/0016/0011) already exist — the design layer just has to mirror them, which is cheap now.

---

## UI probes
*Concrete, runnable checks for Phase-3 / design-review. Each asserts a specific, falsifiable UI fact.*

1. **[state-coverage] Contact-reveal empty-channels has a designed state.** Given a reveal returning `channels: {}`, the UI shows a *reassuring empty-state* (specified copy RU+EN, icon, a next-action CTA) — NOT a blank card, NOT the error state. Assert: distinct component/copy exists; quota is not consumed on empty. *(Today: fails — no such spec.)*
2. **[state-coverage] Zero-results search state exists.** Search returning 0 rows within radius renders an empty-state with a "расширить радиус / сбросить фильтры" recovery action. Assert: component + copy present. *(Today: fails.)*
3. **[state-coverage] Every listed screen has default/loading/empty/error specified.** For search-results, my-listings, my-animals, contact-reveal, moderation-queue, analytics: assert a state matrix entry for all four non-default states. *(Today: none.)*
4. **[state-coverage] Skeleton + optimistic UI specified.** Assert card-list skeletons and optimistic feedback for submit/mark-sold/save-search are in the perceived-performance spec (not just spinners).
5. **[consistency] Design tokens exist and are the single source.** Assert a tokens file defines color (incl. semantic status roles), type scale, spacing, radius, elevation, motion; assert no raw hex/px in component specs. *(Today: fails — no tokens.)*
6. **[consistency] Single user-facing status vocabulary.** Assert a mapping table collapses (`status`,`moderation_status`) into ONE badge phrase per listing; assert the raw enum names never appear in the UI. RU+EN both present.
7. **[consistency] UI-string i18n parity.** Assert every label/button/status/empty-state/error has both `ru` and `en` keys (no key with one language missing) — automatable over the string catalog.
8. **[consistency] No un-backed trust badge.** Assert no "Проверенный заводчик"/verification badge renders unless a real backend verification source exists; badges map to typed data sources only.
9. **[consistency] Error copy is localized + friendly.** For each `error.code`, assert a localized user-facing message + recovery hint exists (not the raw RFC `message`, not English in RU UI).
10. **[a11y] Status/badges are not color-only.** Assert every status/actor/verification badge carries icon+text, and passes a deuteranopia simulation. Assert focus style ≥3:1, touch targets ≥44×44 in component specs.
11. **[a11y] Contrast verifiable from tokens.** Assert every text/UI token pair meets 4.5:1 / 3:1 by computed check (impossible without tokens — ties probe 5).
12. **[a11y] Critical dynamic states announce.** Assert aria-live regions named for reveal-result, submit-errors, zero-results.
13. **[forward-compat] Polymorphic OfferingCard.** Assert a single card abstraction renders animal|service|product|consultation via variant slots (media/title/price-terms/geo/market_scope/status/badges), and that pet-/livestock-marketplace do not each own a bespoke card. *(Today: fails — animal-only card.)*
14. **[forward-compat] Discovery feature + map/list toggle reserved.** Assert a `discovery`/find-nearby feature exists with a map↔list toggle layout seam (not per-market marketplaces). *(Today: fails.)*
15. **[forward-compat] Provider-profile shell reserved.** Assert a provider/org-profile component shell (offerings/reviews/hours/verification tabs) exists as a composition seam.
16. **[forward-compat] Polymorphic filter-panel.** Assert the filter panel is offering-type-driven (can add service/product filters) not hardcoded to animal attributes.
17. **[trust] Actor badge + human-override on operator surfaces.** Assert the moderation/admin surfaces reserve an actor badge (HUMAN default / AGENT variant from `principal_type`) and a human-override control (ADR-0011/0006).

*Probe count: **17**.*

*Scope note:* no built UI exists; all findings are against design-contract artifacts + what the data contracts imply. I modified no product code or docs — this file is my sole output. Items depending on unbuilt frontend or open owner decisions are marked `требует ручной проверки` where noted.
