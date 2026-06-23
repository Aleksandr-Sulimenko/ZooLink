---
name: reference-data-localized-divergence
description: Reference-data code still uses flat name_ru/name_en but contract canon (B0.4) now mandates nameLocalized LocalizedString — open code↔contract gap
metadata:
  type: project
---

**Open code↔contract divergence found 2026-06-23 (doc↔code sweep, flag a/b).**

`admin-api.yaml` (updated by B0.1/B0.4 owner-decisions 2026-06-23) now mandates for `ReferenceDataEntry` / Create / Update:
- `nameLocalized: LocalizedString {en, ru}` (single object) — NOT flat `name_ru`/`name_en`.
- camelCase bodies (B0.1).

But the implemented code still uses flat snake_case `name_ru`/`name_en`:
- `backend/src/modules/admin/dto/reference-data.dto.ts` (Create/Update DTOs + `ReferenceDataEntry` interface).
- `backend/src/modules/admin/reference-data.service.ts` (`toEntry` mapping ~74, search ~97, form template ~131, create ~182).

**Underlying schema** (`species`/`breeds`/`cities`) stores flat `name_ru VARCHAR(100)` + `name_en VARCHAR(100)` (schema lines 16/17, 26/27, 36/37) — NOT JSONB. So conforming the API to `nameLocalized` is either: (a) map flat columns ⇄ `{en,ru}` at the service boundary (cheap, no schema change), OR (b) migrate columns to `name_localized` JSONB (Owner-decision #3 says migrate flat→JSONB for lookups — that's A2 scope). The API-shape fix (a) can ship independently of the column migration.

NOT fixed in the A0a change (out of scope, non-trivial, belongs with A2/admin-slice). Contract is canon here (deliberate owner-decision), so code must follow — this is a real backend TODO, not a contract bug.

INT types are already correct: `speciesId`/`cityId`/`id` are INT in both DTO and contract (✅).
Pagination envelope `{items, meta: PageMeta}` is correct in `lib/pagination/page.ts` (✅).
