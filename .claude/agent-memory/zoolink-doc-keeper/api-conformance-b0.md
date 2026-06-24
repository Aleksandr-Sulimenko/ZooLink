---
name: api-conformance-b0
description: B0 contract conformance canon — pagination envelope, RFC7807, LocalizedString, ETag, 7-role enum
metadata:
  type: project
---

Phase B0 (ADMIN_PHASE_ACTION_PLAN.md) locked these contract-wide rules (owner-decided 2026-06-23):

- **Pagination** = `{items, meta: PageMeta}` where PageMeta = page/limit/total/totalPages, cursor-ready (`meta.nextCursor` optional, additive). Offset-style (matching-api `offset`/`hasMore`) removed.
- **RFC7807** `application/problem+json` `$ref: Problem` on every non-2xx; single `code` enum (VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, INTERNAL, UPSTREAM_UNAVAILABLE, STALE_RESOURCE, PRECONDITION_REQUIRED + domain extensions).
- **LocalizedString {en, ru}** everywhere; removed flat `name_ru`/`name_en` and freeform-JSONB localized maps in contracts. Admin reference-data returns BOTH locales (editor); public returns resolved string.
- **If-Match/ETag** (412 STALE_RESOURCE / 428 PRECONDITION_REQUIRED) on all mutating admin/moderation PATCH.
- **7-role enum**: USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER — threaded into admin-api UserRoleInfo/filters/ChangeUserRoleRequest (was 3).

**Deferred — B0.6 (blocked on ADR-0011):** actor `{actorId, principalType}` in response forms (agent-badge). NOT done in B0 first pass — left as TODO.

Source-of-truth doc: docs/03-architecture/api-contracts/API_CONVENTIONS.md (+ RU mirror). See [[api-casing-canon]].
