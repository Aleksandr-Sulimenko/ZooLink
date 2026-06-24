---
name: contract-files-mirror
description: The 12 EN API contracts and their RU mirrors; favorites-api.yaml RU mirror was missing
metadata:
  type: reference
---

EN canon: `docs/03-architecture/api-contracts/*.yaml`; RU mirror: `docsRU/03-architecture/api-contracts/*.yaml`.

12 contracts: admin, animals, auth, branch, favorites, geo-search, listings, matching, moderation, notification, organization, payment.

**Easy-to-forget mirror gap:** `favorites-api.yaml` had NO RU counterpart until B0.7 (2026-06-23). Always diff the EN vs RU file LIST, not just contents.

YAML contracts: identifiers/numbers/enums/$ref/structure are IDENTICAL between EN and RU — only `description:`/`summary:` prose is translated. So a yaml mirror is mostly a copy with translated prose lines.
