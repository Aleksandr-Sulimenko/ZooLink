---
name: contract-anti-rewrite-findings
description: Consumer-side anti-rewrite findings on ZooLink API contracts vs ADMIN_PHASE_ACTION_PLAN (2026-06-22)
metadata:
  type: project
---

Cross-review of contracts from the SPA/API-client consumer angle, against ADMIN_PHASE_ACTION_PLAN.md + IMPLEMENTATION_PLAYBOOK §5.

**Why:** new phasing rule — pull forward anything whose deferral = rewriting the SHAPE of a contract the SPA binds to.

Top SPA-rewrite risks (response-shape level, NOT covered or under-covered by Plan B):
1. Field-naming split is NOT decided: auth/admin use camelCase JSON (fullName, cityId) but listings/organization use snake_case (animal_id, price_cents) AND localized JSONB keys. A generated client gets two casing worlds. Plan B doesn't address this — biggest single rewrite risk. Needs a normative casing decision (architect, add to API_CONVENTIONS §5/§12).
2. Pagination envelope drift: API_CONVENTIONS §5 mandates `{items, meta:PageMeta}` but admin/listings/org yaml still emit `{items,total,page,limit}` and matching uses `{history,limit,offset,total,hasMore}` with offset (explicitly banned). Client pagination code rewrites once per shape.
3. Error envelope: no contract except favorites $refs `Problem`; responses are bare descriptions. SPA error handling (toast/field-errors off `code`+`errors[]`) can't be generated. Plan B (B-phase) is contract-honesty but doesn't list the mechanical Problem-conformance pass as a blocker.
4. Matching scoreBreakdown already nullable (good, matches GAP-003/B4 plan). But matching uses offset pagination + no Problem — still needs the conformance pass.
5. role-change dup (DIV-2/3): auth-api `/admin/users/{userId}/role` (7-role enum, real) vs admin-api `/users/{id}/role` (3-role enum, unimplemented). SPA must NOT generate the admin-api one. Plan B5 covers it — confirm it's superseded BEFORE any client gen.
6. Role enum split: auth-api = 7 canonical roles; admin-api UserRoleInfo/filters = 3 (USER/MODERATOR/ADMIN). A.A1 (role canon) must reconcile admin-api too or admin UI filters break.
7. LocalizedString inconsistency: convention defines `{en,ru}`; listings/org use freeform `additionalProperties` JSONB; OrganizationUpdate uses flat name_ru/name_en (third form). Three localization shapes = i18n binding rewrite. Tie to A2/doc-keeper.
8. analytics (GAP-011/D1): no contract exists yet. Plan stages it (D1, additive) — fine, low rewrite risk if envelope conventions are locked first.
9. ETag/If-Match only present on /me. Listings/org/animal mutating PATCH have no If-Match documented → optimistic-concurrency UX (412 retry) can't be built consistently; retrofitting headers later forces client interceptor rewrite. Should be in B-phase, currently implicit.

Plan B (contract honesty) is necessary but NOT sufficient for a stable generated client. Missing as explicit blockers: (a) mechanical API_CONVENTIONS conformance pass across all 11 yaml (Problem $ref, PageMeta, x-required-roles, sort), (b) JSON field-casing decision, (c) LocalizedString unification, (d) If-Match coverage on all mutating PATCH. Recommend these become a B0 "client-stable contract" gate before any codegen.
