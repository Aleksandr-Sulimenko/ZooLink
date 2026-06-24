---
name: devtoken-contract-gap
description: dev-token endpoint existed in backend code but was missing from auth-api.yaml; added in B6 as x-internal dev-only with prod-404
metadata:
  type: project
---

B6 (2026-06-24): `POST /auth/dev-token` existed in `backend/src/modules/auth/auth.controller.ts`
(dev-only session minting, 404 in production) but had **no entry in auth-api.yaml**. doc-keeper
added it to both EN and RU contracts:
- path `/auth/dev-token` POST, `operationId: devToken`, `security: []`, `x-internal: true`,
  description states "Disabled in production: NODE_ENV=production → 404".
- new schemas `DevTokenRequest {userId:uuid}` and `TokenPairResponse {accessToken, refreshToken}`.

`whoami` and `operator-check` were already `x-internal: true` — confirmed, no change needed.

How to apply: when auditing contract↔code completeness, dev/internal endpoints in controllers may be
absent from the OpenAPI yaml. Add them as `x-internal: true` rather than omitting, so the contract is
complete and codegen/clients can see they exist but are not product surface.
