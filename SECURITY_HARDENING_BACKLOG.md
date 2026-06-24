# Security & Hardening Backlog

> Output of the **backend-engineer Research & Hardening mode**, round-6 (2026-06-18), run against the
> Phase-0 platform foundation. Tracks what was fixed and what remains. Verified locally:
> lint/typecheck/build/test green; **production `npm audit --audit-level=high` = 0 HIGH**.

## ✅ Done this round (committed)
- **Dependency HIGH CVEs eliminated in the production tree.** `kysely ^0.27.5 → ^0.29.2` (patches the
  JSON-path / `sql.lit` / `Kysely<any>` SQL-injection advisories) and `multer` forced to `^2.2.0` via
  `overrides` (DoS advisories pulled through `@nestjs/platform-express`). Prod audit now clean of HIGH.
- **Coverage gate added** (`backend/jest.config.js`): global floor as a regression ratchet; `main/worker/seed`
  excluded from collection; per-domain ≥90% policy documented inline.
- **CI security-gate policy** (`.github/workflows/ci.yml`): production-tree `npm audit --audit-level=high` is
  the **blocking** gate (reflects the shipped `--omit=dev` image); full-tree audit + Semgrep + Trivy run as
  **advisory** (`continue-on-error: true`) until tuned, then flip to blocking.
- **Kysely injection-hardening rule** recorded normatively in **ADR-0007** (round-6) — EN + RU mirror.

## 🟠 Residual — should-fix (before / with the first domain)
- [ ] **Replace the placeholder Kysely `DB` interface with codegen types** (`backend/src/lib/db/kysely.types.ts`)
      before any geo/JSONB query ships — never `Kysely<any>` (ADR-0007 round-6).
- [ ] **Ratchet coverage to ≥90% per domain**: add per-path `coverageThreshold` entries (e.g.
      `./src/modules/<domain>/`) as each domain lands; raise the global floor accordingly.
- [ ] **Burn down production MODERATE CVEs**: OpenTelemetry chain via `@sentry/node`, `js-yaml` via
      `@nestjs/swagger`. Upgrade when non-breaking; then consider promoting the full-tree audit to blocking.
- [ ] **Tune SAST/container scans**: Semgrep + Trivy → SARIF upload + severity thresholds, then set
      `continue-on-error: false` to make them blocking gates.
- [ ] **dev-only HIGH `undici`** (via test tooling) — upgrade when convenient; it does not ship in the runtime image.

## 🟡 Defer to Phase 2 (leave a hook now)
- [ ] **Gate `/metrics`** (bearer token or network policy) before any cross-host Prometheus scrape. Safe today:
      not proxied by Caddy and the API container publishes no host ports.
- [ ] **CSP at the Caddy edge + explicit CORS allowlist** in `main.ts` (and consider `helmet` on the API as
      defense-in-depth) when the SPA / file uploads land.
- [ ] **Wire `audit_log` + agent-as-principal (ADR-0006)** repudiation path as the first domains record actors
      (an AGENT principal acting as MODERATOR/ADMIN must be least-privilege, fully audited, human-overridable).

## Notes
- Stack reassessment verdict: **keep all pins** (NestJS 11 · Prisma 6 + Kysely · PG16/Redis7/MinIO · monolith,
  ADR-0001/0007/0008/0009). The only watch-item (Kysely) is addressed by version floor + usage discipline, not an
  architecture change — no ADR escalation needed at this time.
- Re-run the R&H mode per domain during Phase 1+ (security + multi-parameter eval), per `IMPLEMENTATION_PLAYBOOK.md`.
