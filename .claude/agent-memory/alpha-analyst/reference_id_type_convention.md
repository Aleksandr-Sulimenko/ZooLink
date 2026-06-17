---
name: reference-id-type-convention
description: ZooLink ID type convention (UUID vs INT) and where docs/contracts drift from it
metadata:
  type: reference
---

ID type convention (owner-confirmed, treat as canonical): business entities = UUID; lookup/reference tables (species, breeds, cities) = INT (SERIAL). So `species_id`/`breed_id`/`city_id` = INT.

**Where docs drift from this (S2 issue class):**
- `branch-api.yaml` declares `city_id` as `format: uuid` — WRONG, should be integer.
- `specs/11-organization-domain.md` (Branch entity table) lists `city_id` as UUID — WRONG.
- `docs/03-architecture/data-model.md` users table lists `city_id UUID` — WRONG (schema has INTEGER).

`database_schema.sql` is correct on these (uses INTEGER); the YAML/specs are the ones to fix.

`animals-api.yaml` correctly declares species_id/breed_id as `type: integer`. Money is `price_cents INTEGER` (minor units, not FLOAT) — keep that pattern for payment amounts (BIGINT minor units) and NUMERIC(5,2) for match scores.

Also note: `users.role` CHECK set differs across 3 sources (schema has USER/MODERATOR/ADMIN/BREEDER/FARMER/VETERINARIAN/GROOMER; data-model.md and identity spec omit VETERINARIAN/GROOMER). Canonical role set is an OPEN QUESTION for the owner.
