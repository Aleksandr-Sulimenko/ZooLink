# AUDIT2 — Janitor lane (HYGIENE / DEAD-CODE / DUPLICATION, forward-compat lens)

**Agent:** janitor · **Branch:** `backend` (not pushed) · **Date:** 2026-07-02
**Method:** re-verified every hygiene item from `AUDIT_2026-06-30.md` against live `backend/src/`, then a
fresh sweep (ts-prune, dup-scan, TODO/orphan). No edits, no commits — this file only.
**Format:** `[severity][criterion][janitor] file:line → problem → fix`

> Legend for verification status: ✅FIXED (since 2026-06-30) · 🔴OPEN · 🟡PARTIAL · 🆕NEW.

---

## 1. Verification of prior-audit hygiene items

### ✅ FIXED since 2026-06-30 (record & close)
- **[INFO][debt][janitor] `src/lib/org/org-membership.service.ts:14`** → prior MAJOR `isOrgAdmin`/`orgAdminIds`
  duplicated across 4 services is **now extracted** to one canonical `OrgMembershipService`; all 4 domain
  services (animal, transfer, listing, moderation) inject and call it. Header docstring cites the audit. **Closed.**
- **[INFO][debt][janitor] `docker-compose.yml:125`** → `minio:latest` floating tag **now pinned** to
  `minio/minio:RELEASE.2025-09-07T16-13-09Z` with a provenance note. **Closed.**
- **[INFO][debt][janitor] `.github/workflows/ci.yml:44,171` + `backend/Dockerfile:5,13,19`** → Node 18↔20 drift
  **resolved**: CI, perf-tests and all Dockerfile stages are uniformly Node 20. **Closed** (verify docs mirror — doc-keeper lane).

### 🔴 STILL OPEN (confirmed present today)
- **[MINOR][debt][janitor] `src/modules/moderation/moderation.service.ts:41` ↔ `src/lib/scheduler/moderation-escalation.service.ts:9`**
  → `SLA_TARGET_SECONDS = { pet: 4*3600, livestock: 6*3600 }` still **duplicated verbatim** in two files;
  escalation file comment even admits "kept in lock-step" — a manual-sync smell. Fix: single exported const
  (e.g. `src/modules/moderation/sla.constants.ts`), both import it. (Ties to alpha's SLA single-source finding.)
- **[MINOR][debt][janitor] `src/modules/listing/listing.service.ts:626` ↔ `src/modules/moderation/moderation.service.ts:577`**
  → `private async marketOf(animalId)` is a **byte-identical copy** (same raw SQL `animals JOIN species`,
  same pet/livestock guard). This is the cross-aggregate read backend+architect flagged (ADR-0004 seam). Fix:
  one shared `MarketResolver`/domain helper; see §3 forward-compat.
- **[MINOR][debt][janitor] `reference-data.dto.ts:41`, `listing.dto.ts:227`, `animal.dto.ts:259`, `moderation.dto.ts:37`, `user-roles.dto.ts:7`**
  → `function toBool(...)` is **5 byte-identical copies** (confirmed diff-clean). Fix: extract to
  `src/lib/http/transforms.ts` (`export const toBool`), import in all 5 DTOs. Cheap, zero-risk.
- **[MINOR][debt][janitor] `src/lib/db/kysely.types.ts:9`** → `interface DB {}` is still an **empty placeholder**
  (`Record<string, never>` intent) though animal/listing/moderation/geo domains are live and raw SQL is used.
  The eslint-disable `no-empty-object-type` masks the gap. Fix: run kysely-codegen (or hand-map the live tables)
  so raw-SQL query result types stop being `any`-ish. `требует ручной проверки` whether codegen is wired in package.json.
- **[MINOR][cleanliness][janitor] `.idea/.gitignore`, `.idea/ZooLink.iml`, `.idea/modules.xml`, `.idea/vcs.xml`**
  → 4 `.idea/*` files **still tracked** even though `.gitignore:` already lists `.idea/` (rule added after commit,
  so tracked copies persist). Fix: `git rm --cached -r .idea` (owner-run; irreversible-ish → owner action, not delegate).
- **[MINOR][cleanliness][janitor] `docs/specs/traceability Matrix.md` + `docsRU/specs/traceability Matrix.md`**
  → **space in filename** still present (×2). Breaks tooling/URLs/CLI without quoting. Fix: rename →
  `traceability-matrix.md`, update inbound links (coordinate doc-keeper for EN↔RU + link fixups).
- **[MINOR][security][janitor] `.github/workflows/ci.yml:185,191,195`** → Semgrep **and** Trivy (and the SBOM/scan
  step at :185) still `continue-on-error: true` → scanners run but **never block** merge; a comment even says
  "flip to false to make blocking." Forward-compat: silent security debt accumulates. Fix: flip to `false` (or
  gate on severity). Coordinate security lane for the severity threshold.

### 🟡 PARTIAL / needs-decision
- **[INFO][cleanliness][janitor] `.env.example:41` `AGENT_SERVICE_SIGNING_SECRET=__change_me__...`** → prior note
  "not following `dev_*` pattern" is now moot in `.env.example` (uniform `__change_me__…` placeholders — good, consistent).
  BUT the **live `.env:51` holds a real-looking secret** `dc9138s-Xfbx…` committed-adjacent (`.env` is gitignored, so not
  in git — verified). Not a leak, but owner should **rotate before any shared/staging use**. `требует ручной проверки` (owner).

---

## 2. Fresh sweep (new findings)

- **[INFO][debt][janitor] backend/src — dead exports]** → **CLEAN.** `ts-prune` finds **no genuinely-unused export**
  (all hits are `(used in module)` re-exports or barrel `lib/providers/index.ts` façade). No dead code, no orphaned
  modules. Good hygiene baseline — worth a CI probe to keep it so (§4).
- **[INFO][debt][janitor] backend/src — TODO/FIXME/HACK]** → **CLEAN.** Zero TODO/FIXME/HACK/XXX/@deprecated in
  non-test source. No latent-debt markers.
- **[MINOR][debt][janitor] `listing.dto.ts:36`, `moderation.dto.ts:27`, `reference-data.dto.ts:34`**
  → `const MARKETS = ['pet','livestock'] as const` **duplicated ×3**, and **`export type Market` is defined twice**
  (`listing.dto.ts:37` + `moderation.dto.ts:28`) each derived from its *own* local `MARKETS`. No single source of
  truth for the market enum. Fix: one `src/lib/market/market.const.ts` exporting `MARKETS` + `Market`; all consumers import.
  **This is a forward-compat hotspot — see §3.**
- **[MINOR][debt][janitor] `animal.dto.ts:36`, `listing.dto.ts:46`, `reference-data.dto.ts:52`**
  → `class LocalizedStringDto` **duplicated ×3** (localized `{en, ru}` validation). Every new localized-content
  domain will add a 4th/5th copy. Fix: extract to `src/lib/http/localized-string.dto.ts`.
- **[INFO][debt][janitor] `src/lib/http/etag.util.ts:8` `weakEtag`]** → **positive example**: ETag logic is already
  centralized and imported by 8+ services. This is the pattern the dups above should follow — cite it as the template.

---

## 3. FORWARD-COMPAT — "extract-before-it-spreads" seams (the main lens)

Ranked by blast-radius as the Offering ecosystem (services/goods/consultation, ADR-A/B) lands:

1. **[MAJOR][debt][janitor] No shared authz/scope enforcement point** (security-flagged; confirmed).
   `OrgMembershipService` centralizes the *membership lookup*, but the **scope composition** —
   "own (seller_id/owner_id) OR org-admin, AND-intersect, 404-no-leak" — is **re-implemented per service**:
   `animal.service.ts:293 listScope`, `listing.service.ts:853 listScopeSql` + `:871 listScope`, plus per-service
   `NotFoundException NOT_FOUND` reimplementations (listing ×8, moderation ×4, animal/transfer ×9). Each new
   Offering type will **copy this again**. **Extract now** a shared `ObjectScope`/authz enforcement helper (single
   own-OR-org-admin predicate + a canonical 404-no-leak throw) before Stage-1 code multiplies it. Escalate the
   design to **architect** (this is the ADR-0004 coupling seam) + **security** (shared enforcement point they asked for).

2. **[MAJOR][debt][janitor] `marketOf` cross-aggregate read (×2, will become ×N)** — §2 dup. Today market is derived
   by a raw `animals JOIN species` read living inside *both* listing and moderation. When services/goods have **no
   species** (market collision, Part-B BLOCKER ADR-B), this exact function must change in every copy. **Extract now**
   to one `MarketResolver` behind an interface so the ADR-B market-source swap is a one-file change.

3. **[MINOR][debt][janitor] Market enum split-brain** — §2 `MARKETS`×3 + `Market` type×2. Registering
   `goods_marketplace` / service markets means editing **5 sites** with no compiler tie. **Extract now** to a single
   `market.const.ts`; then adding a market is one edit and TS flags every non-exhaustive `switch`.

4. **[MINOR][debt][janitor] Per-DTO boilerplate** — `toBool`×5, `LocalizedStringDto`×3. Low blast-radius but pure
   copy-paste that grows linearly with every new module. Fold into `lib/http/` now while it's 3-5 copies, not 15.

**Verdict:** dead-code/TODO hygiene is *excellent* (nothing to prune). The real debt is **duplication of
authz-scope + market logic across services** — cheap to fold today, a maintenance rewrite once 3-4 Offering
services each carry their own copy.

---

## 4. Hygiene probes (Phase-3 / CI-assertable)

Concrete, mechanical checks (each returns pass/fail; wire into CI):

1. **No duplicated `SLA_TARGET_SECONDS`** — `grep -rl "SLA_TARGET_SECONDS *[:=]" backend/src | wc -l` **== 1** (the const definition site). Fail if >1.
2. **No duplicated `marketOf`/market raw-read** — `grep -rn "JOIN species .* WHERE a.id" backend/src/modules | wc -l` **== 1**. Fail if the `animals JOIN species` market read appears in >1 service.
3. **Single market enum** — `grep -rn "\['pet', *'livestock'\]" backend/src | wc -l` **<= 1**; and `grep -rc "export type Market =" backend/src` **== 1**.
4. **Single `toBool`** — `grep -rc "function toBool" backend/src` **== 0** once extracted (all `import { toBool }`); assert `grep -rc "export const toBool" backend/src == 1`.
5. **Single `LocalizedStringDto`** — `grep -rc "class LocalizedStringDto" backend/src` **== 1**.
6. **Single authz/scope helper** — assert a shared `ObjectScope`/scope module exists and per-service `private.*listScope`/inline `NOT_FOUND` throws are **absent** (`grep -rc "private async listScope" backend/src/modules == 0`). (Requires the §3.1 extraction first; probe guards the regression.)
7. **No `.idea` tracked** — `git ls-files .idea | wc -l` **== 0**.
8. **Filenames have no spaces** — `git ls-files | grep -c " "` **== 0**.
9. **Lint is blocking & dead-export-free** — `npm run lint` exits 0 with `--max-warnings 0` (already so); add `npx ts-prune | grep -v "(used in module)" | grep -v index.ts` returns **empty** (no orphan exports).
10. **Scanners block** — `.github/workflows/ci.yml` has **no `continue-on-error: true`** on the Semgrep/Trivy/scan steps (`grep -c "continue-on-error: true" ci.yml == 0`).
11. **Kysely `DB` not empty** — assert `src/lib/db/kysely.types.ts` no longer carries the `no-empty-object-type` disable and declares ≥1 table (guards the placeholder from shipping to prod). `требует ручной проверки` (only after codegen decision).
12. **No new TODO/FIXME debt** — `grep -rniE "TODO|FIXME|HACK|XXX" backend/src --include=*.ts | grep -v spec | wc -l` **== 0** (currently passes — lock it in).

---

*Janitor notes:* No edits/commits made. `.idea` removal and `.env` secret rotation are **owner actions**
(irreversible/security). Filename rename + Kysely codegen cross into doc-keeper / backend-engineer lanes —
flagged, not executed.
