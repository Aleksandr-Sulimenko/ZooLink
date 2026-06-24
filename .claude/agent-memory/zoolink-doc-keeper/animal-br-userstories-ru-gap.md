---
name: animal-br-userstories-ru-gap
description: Pre-existing EN↔RU drift — animal-domain BR has a 'User Stories' block (UC-AN-01..05) in EN that the RU mirror lacks
metadata:
  type: project
---

`docs/02-requirements/business-requirements/animal-domain.md` (EN) contains a full **User Stories** section
(UC-AN-01..05, ~"Animal Management" / "Search & Discovery") that `docsRU/.../animal-domain.md` does **not**
mirror. As of 2026-06-24: EN 291 lines vs RU 243; `grep -c UC-AN-0` → EN 5, RU 0.

**Why it matters:** This is a real mirror gap, NOT introduced by the C2 (GAP-TRACE-007) transfer fix — that
fix is symmetric (block at lines 58–60 both sides). It predates the Admin-phase batch and was left untouched
because it is out of C2 scope.

**How to apply:** When a full EN↔RU consistency sweep of `02-requirements/business-requirements/` is run,
translate the EN User-Stories block into the RU file (or flag for the owner). Compare by `wc -l` + `grep -c UC-`
to detect. Other BR files may have the same UC-block omission — check identity-BR has UC-ID-01..05 in BOTH
(it does, parity 240/240).
