# AUDIT3 — doc-keeper lane (HYPER² round 2, forward-compat + doc consistency)

**Role:** ZooLink Doc Keeper — EN↔RU mirror, glossary, cross-ref, mermaid/ERD, migration-ledger.
**Repo:** `/home/asulimenko/Project/workspace/ZooLink`, branch `backend`, HEAD `4533e78` (NOT pushed).
**Method:** independent evidence sweep first (§1–§6), then diff vs `AUDIT2/doc-keeper.md` (§7).
**Format:** `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Evidence grounded on live `git`, `grep`, `diff`, `ls migrations` at HEAD `4533e78`.

---

## 1. Migration-range drift (hot-spot a)

Ground truth: `ls migrations/*.sql` = **28**; highest prefix **0028**; `grep -c '^CREATE TABLE' database_schema.sql` = **35**.

- `[MINOR][code↔docs][CONFIRMED]` `CLAUDE.md:19` → "Migrations `0001`–`0022` idempotent:" while the per-migration ledger **directly below it (lines 20–47) enumerates through 0028** (0023…0028) → the header **contradicts its own body**. Still unfixed at HEAD `4533e78`. Fix: header → `0001`–`0028`.
- `[MINOR][code↔docs][CONFIRMED]` `../agent-os/instructions/engineering-guide.md:25` → "**35 tables**, migrations `0001`–`0022` idempotent" → table count 35 is correct; range stale. Fix: `0001`–`0028`. (Outside ZooLink repo but is the imported guide.)
- `[MINOR][code↔docs][CONFIRMED]` `docs/specs/10-implementation-roadmap.md:14` + `docsRU/specs/10-implementation-roadmap.md:14` → "31 tables, migrations 0001–0014" (RU: "31 таблица, миграции 0001–0014"). EN↔RU mirrored, framed as the baseline-scaffold snapshot. `требует ручной проверки` whether intentionally historic; if not, refresh to 35 / 0028. (Low — clearly a starting-baseline line.)

> Note: the range is stale in **exactly two live headers** (CLAUDE.md, engineering-guide) + one baseline snapshot. All other places (AUDIT2/AUDIT3 sibling lanes, NEXT_SESSION prompt) already cite 0001–0028. A one-line CI guard is proposed in §6.

---

## 2. Traceability matrix staleness (hot-spot b)

- `[MAJOR][code↔docs][CONFIRMED]` `docs/specs/traceability Matrix.md:3` (`lastUpdated: "2026-06-30"`, `version: "1.3"`) → last commit touching `backend/src/modules/` is **`b7aa6b4` 2026-07-01**; the matrix was last touched by **`25b6195` 2026-07-01 00:53** but its content still reflects the **pre-implementation** state for the 2026-07-01 feature commits `aa3ae3b` (contact-exchange + mark-sold + analytics — closes `contact_reveals`/`sold_at` CRITICALs) and `e1669b8` (ADR-0019 PII crypto seam). The matrix has **no rows recording contact-reveal / mark-sold / analytics as built** (grep for `contact_reveal|sold_at|mark.sold` in the matrix = 0 hits). Fix: re-refresh matrix + `REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md` to bump to v1.4 recording those as delivered, EN+RU.
- `[SEV-CHG MAJOR→MINOR][code↔docs][SSEV-CHG]` `docs/specs/traceability Matrix.md:27` (BR-016) + `favorites-api.yaml` → favorites is listed with its own API contract + `favorites` table, but **no backend module exists** (`backend/src/modules/` = admin, animal, auth, identity, listing, moderation, saved-search; `grep -rl favorite backend/src` = 0). AUDIT2 rated MAJOR ("listed as built"); on closer read the BR-016 cells read **"(MVP additions)" / "(favorites, saved searches, content reports)"** — a **planned-scope grouping**, not a delivered-status claim, so this is a *pending slice*, not a regression. Downgrade to MINOR. Fix / confirm with **backend-engineer**: is favorites a deliberately deferred slice? If so, annotate the row `(planned)`; the contract + ERD table may legitimately precede code (contract-first). `требует подтверждения`.

---

## 3. ADR status drift (hot-spot c) — NEW

Canon per truth-hierarchy: an **ADR file** is tier-2; `ECOSYSTEM_ADR_PLAN.md` self-declares "**Not an ADR — a fast-ratification brief**" (line 3), so the **ADR files are authoritative**, the memo must follow them.

Ground truth (ADR files, EN+RU agree, matched by `README.md` index EN+RU lines 20–27):
0014 Accepted · 0015 Accepted · **0016 Accepted** (security+legal 2026-07-01) · 0017 Proposed · 0018 Proposed · **0019 Accepted** (owner ratified OD-1/OD-2 2026-07-01). Finalized by commit `206549d` ("finalize ADR-0016 + ADR-0019 → Accepted").

- `[MAJOR][cross-ref][NEW]` `docs/04-decisions/ECOSYSTEM_ADR_PLAN.md:4,12,15` **and** `docsRU/04-decisions/ECOSYSTEM_ADR_PLAN.md:4,12,15` → memo still states "**0016/0017/0018/0019 remain Proposed**" (line 4) and its companion-ADR **status table lists 0016 & 0019 as `Proposed`** (lines 12, 15) — **contradicting the finalized ADR files + the README index, which say 0016/0019 = Accepted.** The memo was written before commit `206549d` flipped 0016/0019 → Accepted and was never re-touched. **This is a content-staleness bug, mirrored identically in EN+RU (the mirror is intact — both are equally stale).** Fix: update the memo's line-4 sentence + status-table rows for **0016 and 0019** to `Accepted` (with the 2026-07-01 sign-off note), EN+RU together; leave 0017/0018 = Proposed (they match). Carry the WHAT/WHY/WHY-BETTER triple.
  - Precision note vs the prompt's hot-spot wording ("files 0016/0018/0019 vs memo Proposed"): **0018 is Proposed in both file and memo → no drift there.** The genuine drift is **0016 and 0019 only**. Canon = the ADR files.

---

## 4. EN↔RU mirror & YAML parity (hot-spot d)

- `[PASS][links][CONFIRMED]` **YAML `info.version` parity — still perfect.** All **13** `api-contracts/*.yaml` `info.version` identical EN vs RU (twelve `1.0.0`; `geo-search-api.yaml` `1.1.0` both sides). `favorites-api.yaml` now has its RU twin (versions match). AUDIT2's "yaml stuck on old versions" fear does **not** reproduce at HEAD.
- `[MINOR][links][CONFIRMED]` **4 EN-only files without RU mirror** (EN=120, RU=116, RU-only=0). `diff` of file lists yields exactly:
  - `docs/02-requirements/database-audit-report.md` (historic audit, non-normative)
  - `docs/02-requirements/priority1-completion-summary.md` (historic summary)
  - `docs/localization/migration-summary.md` (**body is Russian-language** — the pair is inverted; RU prose sits in the EN tree)
  - `docs/project-structure-map.md` (partly Russian; non-normative map)
  Fix: mirror each into `docsRU/` (translating/placing prose per language) **or** relocate the four out of the mirrored tree (e.g. `archive/`). Keep the §6 parity probe at 0.
- `[PASS][links][CONFIRMED]` No "Facза" corruption: `grep -rc "Facза" docs docsRU` = **0** both trees. Stands from AUDIT2.
- `[PASS][cross-ref][CONFIRMED]` ADR README index complete + mirrored: 0014–0019 indexed EN+RU (lines 20–25) with statuses matching the ADR files; ECOSYSTEM memo cross-linked (line 27) both trees.

---

## 5. Mermaid / ERD health (hot-spot f)

- `[PASS][mermaid][CONFIRMED]` Fenced-mermaid parity: **23 blocks EN = 23 blocks RU** (mirror intact). `escalated_at` (mig 0024) present in `ZooLink_ERD.mmd:237`; `email_bidx VARCHAR_60` (mig 0028) present at `:84`; `users.email` widened to `TEXT` at `:83`. So the escalation + blind-index changes **did** land in the ERD.
- `[MAJOR][code↔docs][NEW]` `ZooLink_ERD.mmd` (users entity) **and** `docs/03-architecture/data-model.md` → **`users.contact_phone` is absent from BOTH the ERD canon and data-model.md**, but it **exists in `database_schema.sql:970`** (`ADD COLUMN IF NOT EXISTS contact_phone TEXT` — ADR-0019 OD-1, AES-256-GCM ciphertext, "field-encrypted before launch", widened VARCHAR(30)→TEXT). This is a **schema↔ERD/data-model drift on a PII-sensitive, launch-floor column** that the deferred contact-exchange sub-wave C depends on. Per the DB-change workflow (a schema change must touch `ZooLink_ERD.mmd` + `data-model.md`), the ERD canon should carry it. Fix: add `TEXT contact_phone` to the `users` entity in `ZooLink_ERD.mmd` and the users block in `data-model.md` (with the ADR-0019 ciphertext note), EN+RU. `требует ручной проверки` whether contact_phone was ever in the ERD (may be a long-standing omission, not just a 0028 miss).
- `[INFO][mermaid][требует ручной проверки]` Charter baseline says **39 diagrams**; live count = 23 fenced-mermaid blocks per tree + the standalone `ZooLink_ERD.mmd`. The "39" baseline appears stale or counts a wider corpus. Not resolved this round (no mermaid content changed by me); flag for a dedicated `mmdc` render pass. `mmdc` render was **not run** this round.

---

## 6. Forward-compat: is the doc structure ready to carry the ecosystem? (hot-spot e)

- `[MAJOR][forward-compat][CONFIRMED]` **Ecosystem vision is not carried into the requirements canon.** `grep -rln "ecosystem|Offering|ServiceOffering|goods_marketplace|market_scope" docs/02-requirements/` returns **only** `pet-marketplace.md:9` / `livestock-marketplace.md:9` — and those are stray prose ("Offering stud services"), **not** the Offering-supertype / `market_scope` concept. The ecosystem seam lives only in `01-discovery/future-features.md` + ADR-0014/0015/0016 + `ECOSYSTEM_ADR_PLAN.md`. A backend-engineer reading `02-requirements/` first will not discover ServiceOffering / goods_marketplace / provider-model. Fix: add an ecosystem forward-map stub under `02-requirements/` (EN+RU) cross-linking ADR-0014–0019 + `future-features.md`. (Coordinate scope with **architect**.)
- `[MAJOR][forward-compat][CONFIRMED]` **North-star is not a documented metric.** `grep -rln "north.star|north_star" docs/02-requirements/nfr/ docs/specs/` = **0 hits**. It exists only as narrative in `future-features.md`; absent from `nfr/observability.md`, `specs/data-governance.md`, `specs/event-catalog.md`. With no metric definition + no `*.Completed` value-event family, the north-star is uninstrumentable. Fix: record north-star + proxy metrics in `nfr/observability.md` (or data-governance) and reserve the `*.Completed` event family in `event-catalog.md`, EN+RU — joint **data-analyst** + **architect**.
- `[MAJOR→PENDING-ARCHITECT][code↔docs][CONFIRMED]` `docs/02-requirements/business-requirements/pet-marketplace.md:168` (`title | VARCHAR(100)`) + `livestock-marketplace.md:176,178` (`title | VARCHAR(100)`, `price_or_terms | VARCHAR(150)`) → schema has `title_localized JSONB` (`database_schema.sql:250`) and `price_cents BIGINT` (`:252`); `data-model.md` already matches the schema — only the **BR tables** are stale (GAP-BA-001). **Do not silently rewrite the BR** — it encodes a real requirement (free-text terms for MATING/STUD/ADOPTION the `price_cents` column cannot store). Escalate to **architect** (`price_terms_text` seam vs amend BR). (Note: livestock says `VARCHAR(150)` where AUDIT2 quoted `VARCHAR(100)` — same class, minor quote drift.)

---

## 7. Deterministic doc-consistency probes (CI-runnable)

1. `! grep -rq "Facза" docs docsRU` → **PASS** (0 hits).
2. `diff <(cd docs && find . -type f|sort) <(cd docsRU && find . -type f|sort)` empty → **FAIL** (4 EN-only, §4).
3. Per-contract `info.version` EN==RU → **PASS** (13/13).
4. Migration-ledger upper bound in `CLAUDE.md`/`engineering-guide.md` == highest `NNNN` on disk (0028) → **FAIL** (say 0022, §1).
5. `grep -c '^CREATE TABLE' database_schema.sql` (35) == "N tables" in CLAUDE.md/guide/data-model → **PASS** (35 consistent).
6. `traceability Matrix.md` `lastUpdated` ≥ latest commit date on `backend/src/modules/` → **FAIL** (2026-06-30 content < 2026-07-01, §2).
7. `ECOSYSTEM_ADR_PLAN.md` per-ADR status == its ADR-file status → **FAIL** (0016/0019 memo=Proposed, file=Accepted, §3). **NEW probe this round.**
8. Every `users`/`listings` column in `database_schema.sql` appears in `ZooLink_ERD.mmd` → **FAIL** (`contact_phone` missing, §5). **NEW probe this round.**
9. ADR index line-count EN == RU README → **PASS**.

---

## 8. Diff vs AUDIT2/doc-keeper.md

**NEW (2)**
- §3 ADR memo status drift: `ECOSYSTEM_ADR_PLAN.md` (EN+RU) says 0016/0019 Proposed, ADR files + README say Accepted. AUDIT2 §4 asserted "ADRs indexed with statuses, mirrored" and missed the memo↔file contradiction.
- §5 `users.contact_phone` present in schema (`:970`) but absent from ERD canon + data-model.md — schema↔ERD drift on a PII launch-floor column.

**CONFIRMED (8)**
- §1 migration range `0001-0022` in CLAUDE.md:19 + engineering-guide:25 (self-contradiction; unfixed).
- §1 roadmap `31 tables / 0001-0014` baseline snapshot (EN+RU).
- §2 traceability matrix staleness (v1.3/2026-06-30 predates 2026-07-01 feature commits).
- §4 four EN-only files without RU mirror.
- §4 YAML version parity healthy (refutes the "yaml stuck" worry).
- §4 Facза = 0.
- §6 ecosystem vision not in requirements canon.
- §6 north-star not a documented metric.
- §6 BR price_or_terms/title vs schema (GAP-BA-001, pending-architect).

**SEV-CHG (1)**
- §2 favorites listed-vs-built: AUDIT2 **MAJOR** → AUDIT3 **MINOR/planned** — the BR-016 cells are a "(MVP additions)" scope grouping, reading as planned scope (contract-first legitimately precedes code), not a delivered-status regression. Confirm with backend-engineer.

**REFUTED (0)** — no AUDIT2 finding disproven; the yaml-parity risk simply did not reproduce (recorded as CONFIRMED-healthy).

---

## 9. Residual risks / hand-offs (decisions, not mechanical fixes)
- BR `price_or_terms`/`title` vs schema (§6) → **architect** (GAP-BA-001). Do not rewrite BR.
- North-star metric + `*.Completed` event family (§6) → **data-analyst** + **architect**.
- Ecosystem forward-map requirement stub scope (§6) → **architect**.
- favorites built-vs-planned (§2) → **backend-engineer** confirm.
- `mmdc` render pass of all diagrams + reconcile the "39 baseline" claim → follow-up (not run this round).
- No product/doc edits made — this AUDIT3 file is the only artifact. No commit, no push.
