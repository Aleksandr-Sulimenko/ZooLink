---
name: nfr-path-correction
description: nfr/security.md & nfr/observability.md live under docs/02-requirements/nfr, NOT docs/specs/security/nfr (plans sometimes cite the wrong path)
metadata:
  type: reference
---

The NFR docs are at:
- `docs/02-requirements/nfr/security.md` (+ `docsRU/02-requirements/nfr/security.md`)
- `docs/02-requirements/nfr/observability.md` (+ RU mirror)
- `docs/02-requirements/nfr/` is the canonical nfr dir; `docs/specs/security/nfr/` does NOT exist.

ADMIN_PHASE_ACTION_PLAN and other docs sometimes cite `docs/specs/security/nfr/...` — that path is
wrong; resolve to `docs/02-requirements/nfr/`. (security/ has `security_specification.md` and
`rbac-matrix.md`, but the NFR files are under 02-requirements.)

Note: `data-model.md` references nfr files as bare text (e.g. "nfr/observability.md"), not as
markdown links — so they are not broken-link candidates.
