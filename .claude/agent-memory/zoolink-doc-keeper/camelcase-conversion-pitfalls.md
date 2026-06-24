---
name: camelcase-conversion-pitfalls
description: What NOT to rename when converting OpenAPI yaml property names to camelCase
metadata:
  type: feedback
---

When converting a `*-api.yaml` to camelCase (B0.1), a blind global snake→camel regex corrupts the contract.

**Why:** YAML files mix many token kinds; only schema property KEYS and body field names are camelCase. Other snake_case tokens are intentional.

**How to apply — leave these snake_case / untouched:**
- `$ref` target fragments (`#/components/schemas/Some_Thing` — though our schemas are PascalCase anyway).
- enum VALUES (`PENDING_MODERATION`, `stud_service`, `role_in_org` values like `OWNER`).
- §12 sort/filter QUERY parameter names (`species_id`, `listing_type`, `price_min`) — API_CONVENTIONS §12 keeps these snake_case.
- URL path templates (`/organization-users/{id}`).
- `x-required-roles`, `operationId` (already camelCase), security scheme keys.
- DB column references inside prose `description:` text (leave as-is, they describe DB).
- response HTTP status keys, header names (`If-Match`, `ETag`, `Retry-After`).

**Safe targets:** keys under `properties:`, `required:` lists, requestBody field names, response body field names (items/meta/page/limit/total/totalPages stay as-is — already camel or flat).

Edit per-file and eyeball; do not trust a one-shot sed across the directory.
