# zoolink-doc-keeper — Memory Index

- [API casing canon](api-casing-canon.md) — API bodies = camelCase (owner-locked 2026-06-23); DB stays snake_case. Sort/filter params stay snake_case (§12).
- [API conformance canon B0](api-conformance-b0.md) — pagination {items,meta:PageMeta}, RFC7807 Problem, LocalizedString{en,ru}, If-Match/ETag, 7-role enum.
- [Contract files & RU mirrors](contract-files-mirror.md) — 12 EN contracts; favorites-api.yaml had NO RU mirror (created in B0.7). Easy to forget.
- [camelCase conversion pitfalls](camelcase-conversion-pitfalls.md) — what NOT to rename when casing yaml (params, $ref, enum values, descriptions).
- [B0 incidental fixes](b0-incidental-fixes.md) — drift fixed during B0 (UUID→INT lookups, sortBy→sort, settings path); B0.6 deferred items list.
- [Skeleton compare harness](skeleton-compare-harness.md) — python snippet to verify EN↔RU yaml are structurally identical except prose.
- [Actor agent-badge canon](actor-badge-canon.md) — ADR-0011 §6 / API_CONVENTIONS §15: actor={actorId,principalType}; B0.6 done; per-file Actor schema; override-chain fields.
