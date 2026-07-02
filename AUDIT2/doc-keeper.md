# AUDIT2 — doc-keeper lane (Phase 2, HYPER forward-compat)

**Role:** ZooLink Doc Keeper — EN↔RU sync + doc↔code consistency under a forward-compat lens.
**Branch:** `backend` (NOT pushed). **Scope:** verify AUDIT_2026-06-30 wave fixes; EN↔RU parity;
doc↔code drift; forward-compat readiness for the ecosystem (ADR-0014–0019).
**Format:** `[severity][criterion][doc-keeper] file:line → problem → fix`.

---

## 1. Wave-fix verification (AUDIT_2026-06-30 → commit 25b6195)

- ✅ **Facза→Phase (×22 EN canon) — FULLY FIXED.** `grep -rn "Facза"` = **0** hits in `docs/` **and** `docsRU/`.
  Commit `25b6195` ("Facза->Phase canon fix") confirmed touching the 7 flagged files.
- ✅ **Traceability refresh — DONE.** `docs/specs/traceability Matrix.md` + RU mirror now `version: "1.3"`
  (was v1.2), both trees identical version/date. GAP-TRACE-003/005/007 marked ✅ Resolved in
  `REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md` (see §3 for the *new* staleness this introduced).
- ✅ **user-flows vocabulary — FIXED.** `docs/05-ui-ux/user-flows.md` now uses `SOLD` (not `COMPLETED`),
  3-valued moderation, hard-REJECT→`DEACTIVATED` terminal; carries a proper WHAT/WHY/WHY-BETTER triple
  at `:171-173`. No stray `COMPLETED` as a live status.
- ✅ **BACKEND_IMPLEMENTATION_PLAN paths — RESOLVED.** Plan now references `lib/providers/` and
  `lib/outbox/` — both **exist** on disk (`backend/src/lib/providers/{sms,email,maps,storage,payment}`,
  `backend/src/lib/outbox/`). The old dangling `providers/`/`events/` top-level refs are gone.
- ❌ **engineering-guide migration range — NOT FIXED (regressed further).** Audit asked "0001-0022"→0024;
  meanwhile the schema advanced to **0028** (28 migrations on disk). Both range statements are now stale:
  - `[MINOR][code↔docs][doc-keeper]` `CLAUDE.md:19` → "Migrations `0001`–`0022` idempotent" while the ledger
    directly below it lists entries through **0028** (0024/0026/0028) and `ls migrations/*.sql` = 28 →
    header range contradicts its own body. Fix: change header to `0001`–`0028`.
  - `[MINOR][code↔docs][doc-keeper]` `~/Buddhi/agent-os/instructions/engineering-guide.md:25` → "35 tables,
    migrations `0001`–`0022`" → stale range (table count 35 is correct — schema has 35 `CREATE TABLE`).
    Fix: `0001`–`0028`. (Outside the ZooLink repo but is the guide the audit named.)

---

## 2. EN↔RU parity

- ✅ **ADR-0014–0019 mirrored.** All six present in `docsRU/04-decisions/`; `README.md` index lines present
  **both sides** (EN+RU lines 20-25, 37 lines each, statuses/ratification dates matched incl. the
  ECOSYSTEM_ADR_PLAN memo line 27). `template.md` + `ECOSYSTEM_ADR_PLAN.md` mirrored.
- ✅ **YAML version parity — PERFECT.** All 13 `api-contracts/*.yaml` `info.version` identical EN vs RU
  (twelve at `1.0.0`, `geo-search-api.yaml` `1.1.0` both sides).
- ⚠️ **4 EN-only files without RU mirror — STILL PRESENT** (audit P4 item, not yet actioned). EN=120 files,
  RU=116; RU-only=0. Missing mirrors:
  - `[MINOR][links][doc-keeper]` `docs/02-requirements/database-audit-report.md` → no `docsRU/` mirror →
    historic audit report (non-normative). Fix: mirror **or** relocate out of the mirrored `docs/` tree.
  - `[MINOR][links][doc-keeper]` `docs/02-requirements/priority1-completion-summary.md` → no RU mirror →
    historic completion summary (non-normative). Fix: mirror or relocate.
  - `[MINOR][links][doc-keeper]` `docs/localization/migration-summary.md` → no RU mirror; **note: its body
    is already Russian-language** ("Сводка по внедрению…") sitting in the EN tree → the mirror pair is
    inverted. Fix: put RU prose in `docsRU/localization/migration-summary.md`, EN prose in `docs/`.
  - `[MINOR][links][doc-keeper]` `docs/project-structure-map.md` → no RU mirror; body partly Russian
    ("Последнее обновление") → non-normative map. Fix: mirror or relocate.
  - Severity MINOR because all four are historic/report/map artifacts, not canonical specs — but they
    violate the "docs/ is exactly mirrored" canon, so a Phase-3 probe (§5) should keep count at 0.

---

## 3. Doc↔code drift (forward-compat sensitive)

- ❌ **[MAJOR][code↔docs][doc-keeper]** `docs/specs/traceability Matrix.md:2` (`lastUpdated: 2026-06-30`) →
  the v1.3 refresh **predates** commits `e1669b8` (2026-07-01 PII crypto seam / ADR-0019) and `aa3ae3b`
  (2026-07-01 "contact-exchange + mark-sold + analytics — closes contact_reveals/sold_at CRITICALs"). The
  matrix therefore still reflects the *pre-implementation* gap state for those features. Fix: re-refresh
  matrix + gap-audit to record contact-reveal / mark-sold / analytics as built (bump to v1.4, EN+RU).
- ❌ **[MAJOR][code↔docs][doc-keeper]** `docs/specs/traceability Matrix.md:27` (BR-016) + `favorites-api.yaml`
  → favorites presented as a delivered feature (own API contract + `favorites` table in the row), but
  `grep -rn "favorite" backend/src` returns **0** — no controller/service/module for favorites exists
  (`backend/src/modules/` = admin, animal, auth, identity, listing, moderation, saved-search; no
  `favorites/`). Confirms the sba flag "favorites listed as built". Fix: mark favorites as
  planned/unbuilt in the matrix, **or** confirm it's a deliberately deferred slice — `требует
  подтверждения` (planned slice vs regression sets severity).
- 🟡 **[MAJOR→PENDING-ARCHITECT][code↔docs][doc-keeper]** `docs/02-requirements/business-requirements/pet-marketplace.md:168,170`
  + `livestock-marketplace.md:176` → BR data-model tables still declare `title | VARCHAR(100)` and
  `price_or_terms | VARCHAR(100)`, but `database_schema.sql:250,252` has `title_localized JSONB` and
  `price_cents BIGINT` (GAP-BA-001). Architecture doc `docs/03-architecture/data-model.md:138,140`
  **already matches the schema** — only the BR tables are stale. Fix is an open architect decision
  (`price_terms_text` seam vs amend BR); flag remains until adjudicated. **Do not silently rewrite the
  BR** — it encodes a real requirement (text terms for MATING/STUD/ADOPTION) the schema cannot store.
- 🟡 **[MINOR][code↔docs][doc-keeper]** `docs/specs/10-implementation-roadmap.md:14` → "31 tables,
  migrations 0001–0014" describing the baseline scaffold; reads as current but schema is now 35 tables /
  0028. `требует ручной проверки` whether this is intentionally a historic baseline snapshot; if not,
  update. (Low: clearly framed as the starting baseline.)

---

## 4. FORWARD-COMPAT — is the doc structure ready to carry the ecosystem?

- ✅ **ADRs 0014–0019 indexed** in `docs/04-decisions/README.md` (+RU) with statuses and the
  `ECOSYSTEM_ADR_PLAN.md` decision memo cross-linked, mirrored both trees. Ecosystem seam is documented in
  decisions (0014/0015) + discovery (`future-features.md`). Nothing orphaned at the ADR layer.
- ⚠️ **[MAJOR][forward-compat][doc-keeper]** Ecosystem vision lives in **discovery** (`01-discovery/
  future-features.md`) and **decisions** (ADR-0014/0015, ECOSYSTEM_ADR_PLAN) but is **not carried into the
  requirements canon** (`docs/02-requirements/`). Scattered ADR mentions exist (identity-domain, nfr/
  security, admin-domain) but there is no consolidated "ecosystem / Offering-supertype forward-map"
  requirement doc. Risk: when building resumes, the ecosystem seam (ServiceOffering, goods_marketplace,
  provider model) is discoverable only via discovery+ADRs, not from the normative requirements a
  backend-engineer reads first. Fix: add an ecosystem forward-map stub under `02-requirements/` (EN+RU)
  cross-linking ADR-0014–0019 + future-features §145-227.
- ⚠️ **[MAJOR][forward-compat][doc-keeper]** **North-star is not a documented metric.** It appears only as
  narrative in `docs/01-discovery/future-features.md`; **absent** from `nfr/observability.md`,
  `specs/data-governance.md`, and `specs/event-catalog.md`. This mirrors the Part-B CRITICAL
  ("North-star uninstrumentable"): with no metric definition + no value-event (`*.Completed`) family in the
  event catalog, the north-star cannot be tracked or built toward. Fix: record north-star + its proxy
  metrics in `nfr/observability.md` (or data-governance) and reserve the `*.Completed` event family in
  `event-catalog.md` (EN+RU) — coordinate with **data-analyst** + **architect**.

---

## 5. Doc consistency probes (Phase-3 / CI runnable)

Concrete, deterministic checks the owner asked for — all runnable from repo root:

1. **No "Facза" corruption** (EN canon):
   `! grep -rq "Facза" docs/ docsRU/` → must exit 0 (currently passes).
2. **EN↔RU file-count / path parity**:
   `diff <(cd docs && find . -type f | sort) <(cd docsRU && find . -type f | sort)` → must be empty.
   (Currently fails: 4 EN-only files listed in §2.)
3. **YAML `info.version` parity EN vs RU** (per contract):
   for each `docs/03-architecture/api-contracts/*.yaml`, first `version:` must equal its `docsRU/` twin.
   (Currently passes.)
4. **Migration ledger range = files on disk**:
   header range in `CLAUDE.md` (and `engineering-guide.md`) upper bound must equal
   `ls ZooLink/migrations/*.sql | wc -l` (28) and the highest `NNNN` prefix (0028).
   (Currently fails: header says 0022.)
5. **Table-count consistency**:
   `grep -c '^CREATE TABLE' database_schema.sql` (=35) must equal the "N tables" claim in `CLAUDE.md`,
   `engineering-guide.md`, and `data-model.md`. (35 currently consistent in CLAUDE.md/guide.)
6. **Traceability freshness gate**:
   `traceability Matrix.md` `lastUpdated` must be ≥ the latest commit date touching `backend/src/modules/`
   (schema/feature changes must re-touch the matrix). (Currently fails: 2026-06-30 < 2026-07-01.)
7. **No dangling doc→path refs**: every `backend/src/...`, `lib/...`, `migrations/...` path cited in
   `BACKEND_IMPLEMENTATION_PLAN.md` / `data-model.md` must resolve on disk. (Currently passes for the plan.)
8. **ADR index completeness**: every `docs/04-decisions/00NN-*.md` (and RU twin) must have a matching index
   line in the respective `README.md`; EN and RU README line-count equal. (Currently passes: 37=37.)

---

## Residual risks / hand-offs
- BR `price_or_terms`/`title` vs schema (§3) = **architect** decision (GAP-BA-001), not a mechanical fix.
- North-star metric + `*.Completed` event family (§4) = **data-analyst** + **architect** joint.
- favorites built-vs-planned (§3) = confirm with **backend-engineer** whether a deferred slice.
- No product/doc edits made — per instructions this file is the only artifact. No commit, no push.
