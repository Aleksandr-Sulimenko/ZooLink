# ZooLink HYPER² Audit — Round 2 · janitor (hygiene / duplication / doc-drift)

**Date:** 2026-07-02 · **Branch:** `backend` @ `4533e78` (not pushed) · **Method:** fresh grep/read sweep of
`backend/src`, `docs/04-decisions`, `docs/specs`, `.github/workflows/ci.yml`, `.gitignore`/`.env`, and the
CLAUDE.md/engineering-guide migration ledger — re-derived from the live repo, then reconciled against
`AUDIT2/janitor.md`. Main lens: **forward-compat** (duplication that multiplies per new Offering type) +
**hygiene/doc-drift** (stale headers, ADR-status-vs-code, repo cruft).

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.

---

## Diff scoreboard

- **#NEW = 4** · **#CONFIRMED = 10** · **#REFUTED = 0** · **#SEV-CHG = 1**
- Sharpest thing round-1 missed: the **market-enum split-brain it flagged as "×3, will spread" already
  spread to ×4** before round-1 even ran (`saved-search` module, committed 2026-06-30, predates round-1's
  2026-07-02 date) — round-1's own probe (`grep "\['pet', *'livestock'\]"`) would have caught it (returns 4,
  not 3) but the prose undercounted. The prediction was correct; the count was stale on arrival.
- Second-sharpest: **two doc-drift items round-1 never looked for** — the migration-range header
  (`CLAUDE.md:19`, `engineering-guide.md:25`) still says `0001–0022` while the repo is at **0028**, and
  ADR-0018 is still stamped `Proposed — awaiting owner nod` while **its ownership-check half already shipped**
  in commit `871589e` (2026-07-01) — the doc lags the code it's supposed to gate.

---

## 1. Re-verification of round-1 hygiene items (all confirmed present, unchanged unless noted)

- **[MINOR][debt][CONFIRMED] `backend/src/modules/moderation/moderation.service.ts:41` ↔
  `backend/src/lib/scheduler/moderation-escalation.service.ts:9`** → `SLA_TARGET_SECONDS = { pet: 4*3600,
  livestock: 6*3600 }` still duplicated verbatim, same lines as round-1. Escalation file's own comment still
  says "kept in lock-step." Fix unchanged: single exported const in `src/modules/moderation/sla.constants.ts`.

- **[MAJOR][debt][CONFIRMED] `backend/src/modules/listing/listing.service.ts:626` ↔
  `backend/src/modules/moderation/moderation.service.ts:577`** → `private async marketOf(animalId)` still a
  byte-identical raw `animals JOIN species` read in both files, same lines as round-1. **New evidence this
  round:** ADR-0018 (`docs/04-decisions/0018-cross-aggregate-access-rule.md`) exists *specifically* to kill
  this class of cross-aggregate read and was **partially implemented** in commit `871589e` (2026-07-01) —
  but only the ownership-check half (`loadAnimal`/`assertOwnsAnimal` → `AnimalService.getOwnedAnimalForActor`).
  `marketOf` was **not** touched and remains duplicated. The ADR names the fix; the fix is half-done. See §3
  ADR-status item below — this is the same debt, now with a stalled remediation vehicle.

- **[MINOR][debt][CONFIRMED] `reference-data.dto.ts:41`, `listing.dto.ts:227`, `animal.dto.ts:259`,
  `moderation.dto.ts:37`, `user-roles.dto.ts:7`** → `function toBool(...)` still 5 byte-identical copies, same
  lines. Fix unchanged: `src/lib/http/transforms.ts` (`export const toBool`).

- **[MINOR][debt][CONFIRMED] `animal.dto.ts:36`, `listing.dto.ts:46`, `reference-data.dto.ts:52`** →
  `class LocalizedStringDto` still duplicated ×3, same lines. Fix unchanged.

- **[MAJOR][debt][CONFIRMED] no shared authz/scope enforcement point** →
  `animal.service.ts:293 listScope`, `listing.service.ts:853 listScopeSql` + `:871 listScope` still
  independently reimplement the "own OR org-admin, AND-intersect, 404-no-leak" predicate; per-service
  `NotFoundException` throws remain scattered across 13 non-spec files (`listing.service.ts`,
  `moderation.service.ts`/`content-report.service.ts`, `animal.service.ts`/`transfer.service.ts`,
  `saved-search.service.ts`, `identity/admin-user.service.ts`, `admin/reference-data.service.ts`,
  `admin/system-setting.service.ts`, `auth.controller.ts`) — **one more consumer than round-1 counted**
  (`saved-search.service.ts` didn't exist... it did (committed 2026-06-30) but round-1's file list omitted it).
  Still MAJOR forward-compat risk: every new Offering type re-derives this predicate. Extract now
  (architect + security own the design, per round-1).

- **[MINOR][cleanliness][CONFIRMED] `.idea/.gitignore`, `.idea/ZooLink.iml`, `.idea/modules.xml`,
  `.idea/vcs.xml`** → still tracked despite `.gitignore:22` listing `.idea/`. Fix: `git rm --cached -r .idea`
  (owner action — irreversible-ish).

- **[MINOR][cleanliness][CONFIRMED] `docs/specs/traceability Matrix.md` + `docsRU/specs/traceability
  Matrix.md`** → space in filename, ×2, unchanged. Fix: rename to `traceability-matrix.md` (doc-keeper lane).

- **[MINOR][security][CONFIRMED] `.github/workflows/ci.yml:185,187,191,195`** → Semgrep/Trivy/SBOM steps
  still `continue-on-error: true`; the inline comment still says "flip to false to make blocking." Scanners
  run, never gate. Fix: flip to `false` or gate on severity (security lane for threshold).

- **[MINOR][debt][CONFIRMED] `backend/src/lib/db/kysely.types.ts:9`** → `interface DB {}` still the
  documented placeholder (`no-empty-object-type` eslint-disable). **New evidence this round:** the raw-SQL
  surface it's supposed to type has grown — `aa3ae3b` (2026-07-01, contact-exchange) added another
  `this.prisma.$queryRaw<{ market: string }[]>` call in `listing.service.ts`, typed ad hoc at the call site
  instead of through the shared `DB` interface. Each new raw query invents its own inline generic; the
  placeholder gap compounds. `требует ручной проверки` whether kysely-codegen is wired in `package.json`
  (still not run, as of this commit).

- **[INFO][cleanliness][CONFIRMED] `.env:51` `AGENT_SERVICE_SIGNING_SECRET=dc9138s-XfbxVHssQSiwCZDPs7HgezhgwwBPoTFysQRxxgTU`**
  → still a real-looking secret in the local (gitignored, not leaked) `.env`. `.env.example` stays uniform
  placeholders — good. Owner should rotate before any shared/staging use. `требует ручной проверки` (owner).

**Re-confirmed clean baselines (still hold, worth locking into CI):**
- `ts-prune` / dead-export sweep: still **CLEAN** (0 genuine unused exports).
- TODO/FIXME/HACK/XXX in non-test `backend/src`: still **0**.

---

## 2. SEV-CHG — round-1 undercounted, prediction proved worse than stated

- **[MINOR→MAJOR-watch][debt][SEV-CHG] `backend/src/modules/saved-search/dto/saved-search.dto.ts:33`** →
  round-1 said "`MARKETS` duplicated ×3" (`listing.dto.ts:36`, `moderation.dto.ts:27`,
  `reference-data.dto.ts:34`) and predicted it "will multiply." It already had: `saved-search.dto.ts:33`
  defines a **4th** copy, `export const SAVED_SEARCH_MARKETS = ['pet', 'livestock'] as const` (+ its own
  `SavedSearchMarket` type), committed **2026-06-30** in `67588bb` — i.e. it existed *before* round-1 ran
  (2026-07-02) and round-1's own proposed CI probe (`grep -rn "\['pet', *'livestock'\]" backend/src | wc -l`
  **<= 1**) would return **4** today, not the ≤1 it assumes as the fixed-state target. Net: the split-brain
  is worse than reported (4 sites, 2 differently-named consts/types with zero compiler tie) and it grew
  *while the debt was already open*, confirming this is the single highest-value forward-compat extraction
  in the repo — every future market-gated module (goods_marketplace, services) is one more copy away. Fix
  unchanged in kind, more urgent in degree: one `src/lib/market/market.const.ts` exporting `MARKETS` +
  `Market`; `saved-search` re-exports/imports it instead of inventing its own.

---

## 3. NEW findings (round-1 did not check these)

- **[MINOR][doc-drift][NEW] `ZooLink/CLAUDE.md:19` + `agent-os/instructions/engineering-guide.md:25`** →
  both say "migrations `0001`–`0022` idempotent" / "migrations `0001`–`0022`". The actual migration directory
  (`ZooLink/migrations/`) runs **0001 through 0028** (verified: `20260701_0028_pii_email_blind_index_encrypt.sql`
  is the newest file on disk); `ZooLink/CLAUDE.md` itself documents 0023–0028 further down in the same file,
  so the file **contradicts its own header**. Fix: update both headers to `0001`–`0028` (or drop the fixed
  upper bound and just say "see the ledger below/`migrations/`" to stop this recurring every migration).
  doc-keeper lane; cheap, mechanical.

- **[MINOR][doc-drift][NEW] `docs/specs/traceability Matrix.md`** → last touched by `25b6195`
  (2026-07-01 00:53, "traceability refresh"), but **four feature-closing commits landed later the same day**:
  `e1669b8` (13:30, PII crypto), `aa3ae3b` (15:02, contact-exchange + mark-sold + analytics — explicitly
  "closes contact_reveals/sold_at CRITICALs"), `b7aa6b4` (22:03, QA-gate coverage), plus `saved-search`
  (`67588bb`, 2026-06-30, already predates the "refresh" but isn't reflected either — only 2 generic mentions
  of `/saved-searches` as a planned endpoint, no closed-status marker). The matrix's freshness claim ("refresh")
  is stale by same-day same-file standards. `требует ручной проверки` (doc-keeper) for the exact status-cell
  semantics, but the file-level staleness vs. the Jul-1 15:02+ commits is verified.

- **[MINOR][doc-drift][NEW] `docs/04-decisions/0018-cross-aggregate-access-rule.md:3`** → Status line reads
  `Proposed — ready (low-risk, reaffirms ADR-0004); awaiting owner nod (reviewed Q1–Q6 2026-07-01)`, but
  commit `871589e` (2026-07-01 12:03, same day) **already implements half of it** in code (commit message:
  "route listing->AnimalService (ADR-0018)") — `ListingService`'s direct `animals`-table read + duplicated
  ownership check were removed and routed through `AnimalService.getOwnedAnimalForActor`. The ADR is still
  formally un-Accepted while its central claim is already partially shipped, and the other half (`marketOf`,
  §1 above) is silently NOT done — so "Proposed" is simultaneously stale (part already true) and premature
  (part still pending) with no doc marker distinguishing the two halves. Fix: either split ADR-0018 into
  ADR-0018a (ownership-check, ship as Accepted, done) / ADR-0018b (`marketOf`, still Proposed), or add a
  scoped implementation-status line inside the ADR body listing which sub-clauses are done. architect lane.

- **[INFO][cleanliness][NEW] top-level `AUDIT2/`, `AUDIT3/` directories** → each hyper-audit round creates a
  new top-level `AUDIT<N>/` folder (`AUDIT2/` is tracked in git as of `4533e78`, 18 role files +
  `PHASE3_HYPERTEST.md`; `AUDIT3/` is the current round, untracked so far). This is itself a forward-compat/
  hygiene pattern to watch: round 3 → `AUDIT3/`, round 4 → `AUDIT4/`, with no consolidation — top-level repo
  clutter grows linearly with audit cadence, and nothing prunes `AUDIT2/` once `AUDIT3/` supersedes its still-
  open items. Not urgent, but cheap to fix before it's ×5: consolidate into a dated archive
  (`docs/audits/2026-07-02-round2/`) or keep only the latest round at top level and move prior rounds under
  `archive/` once their open items are re-triaged into the live backlog. `требует ручной проверки` (owner
  preference on audit-artifact retention policy) — no action taken, proposal only.

---

## 4. Hygiene probes (mechanical, CI-assertable — supersedes round-1 §4 where counts changed)

1. `grep -rl "SLA_TARGET_SECONDS *[:=]" backend/src | wc -l` **== 1** (currently 2 — fail).
2. `grep -rn "JOIN species .* WHERE a.id" backend/src/modules | wc -l` **== 1** (currently 2 — fail).
3. `grep -rn "\['pet', *'livestock'\]" backend/src | wc -l` **<= 1** (currently **4**, not 3 — round-1's
   assumed baseline was already wrong; re-baseline after the extraction).
4. `grep -rc "function toBool" backend/src | grep -v ':0'` **empty** (currently 5 files — fail).
5. `grep -rc "class LocalizedStringDto" backend/src | grep -v ':0'` **count of files == 1** (currently 3 — fail).
6. `git ls-files .idea | wc -l` **== 0** (currently 4 — fail).
7. `git ls-files | grep -c " "` **== 0** (currently 2 — fail, both traceability-matrix files).
8. `grep -c "continue-on-error: true" .github/workflows/ci.yml` **== 0** (currently 3 — fail).
9. `grep -n "0001.*0022" CLAUDE.md agent-os/instructions/engineering-guide.md` **empty once migration ledger
   passes 0022** (currently 2 hits, both stale — new probe this round).
10. `npx ts-prune | grep -v "(used in module)" | grep -v index.ts` **empty** — currently passes, lock it in.
11. `grep -rniE "TODO|FIXME|HACK|XXX" backend/src --include=*.ts | grep -v spec | wc -l` **== 0** — currently
    passes, lock it in.

---

*Janitor notes:* No edits/commits/deletions made — this file only. `.idea` removal and `.env` secret rotation
remain **owner actions**. Filename rename, traceability-matrix refresh, ADR-0018 status split, and the
migration-header fix cross into doc-keeper/architect lanes — flagged here, not executed. All duplication
items (§1, §2) are safe, mechanical, zero-behavior-change extractions a backend-engineer can do in one pass;
none require an owner decision except the AUDIT-dir retention question (§3, INFO, non-blocking).
