---
name: frontend-phase-status
description: Frontend is Phase 2; this agent prepares the API/contract surface only, does not build UI until the phase is opened
metadata:
  type: project
---

Frontend/SPA is a later phase (Phase 2). The zoolink-frontend-engineer is a deliberate placeholder.

**Why:** architecture decision (framework, SSR vs SPA, design system, i18n strategy) belongs to zoolink-architect via a new ADR with the owner, not to be decided unilaterally now.

**How to apply:** until the owner opens the frontend phase, only (1) read OpenAPI contracts + docs/05-ui-ux, describe the API surface the SPA will consume; (2) surface anti-rewrite contract risks; (3) note conventions the SPA must honor. Do NOT scaffold a UI stack, pick a framework, or add frontend to CI.

Edge topology is fixed: Caddy serves SPA build from `/srv/www` with `try_files … /index.html` (ADR-0009). Design the SPA within that.
