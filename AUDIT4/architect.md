# ZooLink HYPER³ Audit — Round-3 · architect (seams / phasing / scale / agent-runnability)

**Date:** 2026-07-08 · **Branch:** `backend` · **HEAD:** `0fcc182` · **Method:** independent
re-derivation on live schema + migrations + `backend/src` (read-only; ran NO test suite, modified
no product code), then diffed against `AUDIT3/architect.md` + `AUDIT2/architect.md`. Finding format:
`[severity][criterion][axis][state] file:line → problem → fix`. Axis ∈ same|new|trash|strat.
State ∈ NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED.

> **Verified baseline (inspected 2026-07-08, HEAD 0fcc182):**
> - **ADR-0018 cross-aggregate breach is CLOSED.** `marketOf` raw `animals⋈species` is **gone** from
>   both `listing.service.ts` and `moderation.service.ts`; market now reads the derived `listings.market`
>   cache (D3 migration 0033 / D8). The queue CTE (`moderation.service.ts:190-194`) still joins
>   `animals⋈species` but **only to project `species.code` for display**, carrying an explicit
>   `grep-allow-market-join` marker; market = `l.market`. The AUDIT3 CRITICAL (3-site, partly-circular) is fixed.
> - **Favorites is now BUILT** (`favorite.*`) **with the OfferingRef seam landed alongside it**
>   (`offering_type='ANIMAL_LISTING'`/`offering_id` NOT NULL, migration 0032) — exactly the AUDIT2/3
>   recommendation ("reserve in the same slice that ships favorites").
> - **ADR status inversions RESOLVED:** 0018 Accepted (owner-confirmed 2026-07-05, two-ordered-parts note
>   present), 0022 multi-role Accepted, 0014/0015/0016 Accepted. The chain is monotonic.
> - **Agent-as-principal is broad:** `principal_type HUMAN|AGENT` recorded at every actor site
>   (moderation_decisions, ownership_transfers, content_reports, consents, audit_log, user_roles). Only
>   **moderation** has a live *autonomy bound* (`agent_moderation` feature toggle, `moderation.service.ts:289`).

---

## FIXED-VERIFIED (the fix-program truly closed these, not green-masked)

- `[was-CRITICAL][forward-compat][same][FIXED-VERIFIED] moderation.service.ts:190-194 + listing.service.ts → the 3-site ADR-0018 `animals⋈species` market breach is genuinely removed. Confirmed by reading both services: market is `l.market` (D3 cache), the surviving join projects only `species.code` and is gate-marked. The AUDIT3 "partly-circular with ADR-0014 read-model" tension dissolved — D3 cached-column was the cheaper cycle-breaker than a full discovery read-model, and it works. Genuinely closed.`
- `[was-MAJOR][consistency][same][FIXED-VERIFIED] docs/04-decisions/0018,0022 → the prerequisite-before-dependent status inversion (0014 named 0018 a prerequisite while 0018 was Proposed) is resolved: 0018 Accepted 2026-07-05 with the ordered-parts note the AUDIT3 probe P3′ demanded. ADR-0022 (multi-role junction) Accepted and landed dormant (migration 0034, `users.role` still authoritative). No longer findings.`
- `[was-MAJOR][SPOF][same][FIXED-VERIFIED] favorites → dormant-reservation window closed correctly: favorites shipped WITH `(offering_type,offering_id)` (0032), no listing-only-FK data written at volume, contract exposes `offeringType`/`offeringId` with `listingId` as deprecated alias. The retrofit-becomes-breaking risk is defused as recommended.`

## 🔴 NEW — scale / write-on-read / resilience (design-level fragility)

- `[MAJOR][forward-compat][new][NEW] listing.service.ts:288 (+ database_schema.sql:700-705 universal updated_at trigger) → view-count capture does `prisma.listings.update({data:{view_count:{increment:1}}})` on the PUBLIC detail read. Every table with `updated_at` gets a `BEFORE UPDATE … NEW.updated_at=NOW()` trigger, so **every counted view bumps `listings.updated_at`**. Two structural consequences: (1) the weak ETag is `weakEtag(listing:id, updated_at)` (listing.service.ts etag()) → **view traffic busts the public-read ETag/Cache-Control on every hit**, defeating conditional-GET caching on the hottest endpoint; (2) **it races optimistic concurrency** — a viewer bumping `updated_at` between a seller's GET and their `If-Match` PATCH yields a spurious 412 PRECONDITION_FAILED; on a popular listing the seller/operator can be locked out of editing by read traffic. Plus hot-row lock contention + MVCC bloat on the primary query table. → Do NOT couple a high-frequency counter to the entity row's `updated_at`. Options for an ADR: (a) `UPDATE … SET view_count=view_count+1` via raw SQL that also re-sets `updated_at=updated_at` is still trigger-fired — instead **exclude `view_count` from the ETag/If-Match basis** (version the row by a dedicated `edit_version` column, not `updated_at`); or (b) move the counter off-row (Redis-buffered, periodic flush to a `listing_stats` sibling). (b) also removes the hot-row contention. Propose ADR "view-count off the concurrency/ETag path".`
- `[MAJOR][forward-compat][new][NEW] migrations/…0033_listings_market_cache.sql:47-66 (listings.market VARCHAR(9) NOT NULL, no DEFAULT) → **N-1 rolling-deploy hazard.** The create path is the only writer and sets `market` in-tx, but the column is NOT NULL with **no DEFAULT**. During a rolling deploy the N-1 API pods (which don't know the column) `INSERT` a listing without `market` → NOT NULL violation → 500s for the deploy window. This is the classic expand/contract trap. → either give the column a transient `DEFAULT` (backfilled/derived) held for one release then dropped, or a `BEFORE INSERT` trigger that derives market from the animal when the app omits it. Bake an "N-1 write-compat" line into the DB-change workflow (DoD): a new NOT NULL column on an app-written table needs a DEFAULT or trigger until N-1 is retired.`
- `[MAJOR][resilience][new][CONFIRMED] animal/transfer.service.ts:31,226-230 (72h expiry lazy-on-read, "no worker in MVP") → the ownership-transfer `Expired` event is emitted only when someone GETs the row. Migration 0030 wired a real notification consumer for `OwnershipTransfer.Expired`, so the path now EXISTS — but it is **starved by the lazy trigger**: if neither party reads after 72h, no expiry event, no notification, the animal stays PENDING-locked (partial-unique INV-4) and both sides go silent. AUDIT3 (psychologist) flagged the silence; it is sharper now because the notify side is built but never fires. → adopt the pattern the platform already has: moderation SLA-escalation runs a periodic tick under advisory-lock key `MODERATION_ESCALATION_TICK=4202` (migration 0024). Add a `TRANSFER_EXPIRY_TICK` worker sweeping `status='PENDING' AND expires_at<now()`. Same shape, already proven.`
- `[MINOR][performance][new][NEW] notification/notification.consumer.ts:56-101 → per-recipient serial fan-out: for each recipient the consumer runs `preferredLanguage` + `loadTemplate` + INSERT as separate awaited round-trips, re-querying the (identical) template per recipient. For org fan-out (`orgAdminUserIds`) this is N×3 serialized queries inside the single worker relay. Fine at MVP volume; a throughput cliff under a moderation/transfer storm (one slow worker, at-least-once retries re-walk the whole recipient list). → hoist the template/context load out of the recipient loop; batch the INSERTs (`INSERT … VALUES (…),(…) ON CONFLICT DO NOTHING`). Not urgent — flag for the notification-scale slice.`
- `[MINOR][correctness][new][NEW] listing.controller.ts:92 (@Ip) + captureView anon dedup → the anon view dedup key is the client IP via `@Ip()` (= Express `req.ip`). Without `trust proxy` set (not found in main.ts — requires manual verification), behind a load balancer ALL anonymous traffic collapses to the LB's IP → the 30-min dedup counts ~1 anon view per listing globally (massive UNDER-count); with a naive `trust proxy`, the key becomes XFF-spoofable (over-count). Either way the **one analytics signal that cannot be backfilled (views)** is untrustworthy at the anon tier. → decide the proxy/XFF trust boundary explicitly (devops+security) and document how the anon viewer key is derived; consider a signed anon cookie instead of raw IP.`

## 🟠 TRASH lens (adversarial → tag security)

- `[MAJOR][trash][trash][NEW] listing detail GET view-flood → an attacker rotating IPs (anon path) or refreshing across the 30-min window can (1) **pollute the irrecoverable `views` funnel signal** at will, (2) via the `updated_at` bump chain above, **grief a target seller**: flood a listing with views → `updated_at` churns → the seller's/operator's `If-Match` edits perpetually 412 (edit lock-out with no error the victim can act on), and (3) each forged view is a row-lock WRITE on one `listings` row → cheap **hot-row write-amplification / DoS** on a chosen listing. This is the same defect as the view-count finding, weaponized. → exploit chain `→ security`: the fix is the same (counter off the entity row + off the ETag/concurrency basis) plus rate-limiting the counter write, not just the read.`

## 🔵 STRATEGIC — agent-runnability scorecard (you own this)  [NS|WW|PERSP]

North-Star (ADR-0006): operator roles — moderation → admin → business-ops — performed over time by AI
agents. Rating per domain for an AI agent to operate it **end-to-end**: is there an **API path**
(not UI-only — trivially YES here, backend-only phase), **idempotency** on unsafe writes,
**audit/actor-snapshot**, **human-override**, and a **safe autonomy bound** (a gate that lets a human
cap/kill agent action)? READY = all present · SEAM-NEEDED = actor-snapshot present but ≥1 gate missing ·
BLOCKED = a structural piece absent.

| Domain | API | Idempotency | Audit/actor-snapshot | Human-override | Autonomy bound | **Verdict** |
|---|---|---|---|---|---|---|
| **moderation** (decide/claim) | ✅ | ✅ Idem-Key + guarded updateMany | ✅ `actor_principal_type`+`actor_role` per decision | ✅ supersede + `is_human_override` | ✅ `agent_moderation` toggle | **READY** (the reference implementation) |
| **content-report** (resolve) | ✅ | ✅ guarded transition | ✅ CR-9 actor/principal snapshot | ⚠️ resolve is terminal, no supersede | ❌ no agent toggle | **SEAM-NEEDED** (add autonomy gate + reopen/override) |
| **identity/auth** (agent *bootstrap*) | ⚠️ | n/a | ✅ | n/a | ❌ | **SEAM-NEEDED** — `AgentServiceTokenAuthenticator` is a stub, `service_credentials` (0017) unseeded; an AGENT can be *represented* in a JWT but there is **no live path for a machine to obtain a token**. This gates ALL other domains for real autonomy. |
| **admin** (system-setting, reference-data, role-change) | ✅ | partial | ✅ actor snapshot on audit/role paths | ⚠️ | ❌ no agent gate | **SEAM-NEEDED** — this is the **declared Phase-2 operator surface** ("moderator → admin", ADR-0006) yet has none of the moderation safety pattern. |
| **listing** (create/submit/withdraw) | ✅ | ✅ Idem-Key + TOCTOU updateMany | ⚠️ seller_id only, no principal snapshot on the listing row | n/a | ❌ | **SEAM-NEEDED** (if an agent seller/operator is ever intended) |
| **transfer** | ✅ | ✅ single-use consume | ✅ initiated/responded principal_type | ✅ decline/cancel | ❌ + lazy-expiry starves events | **SEAM-NEEDED** (expiry worker + autonomy gate) |
| **favorite / saved-search** | ✅ | ✅ DB UNIQUE | ➖ personal data, low-stakes | n/a | n/a | **READY** (low autonomy risk by nature) |
| **notification** (consumer) | ✅ worker | ✅ idempotency_key | ✅ | n/a | ✅ registry allow-list (not `*`) | **READY** |

**Anti-North-Star debt (ranked):**
1. `[NS][PERSP] agent-auth bootstrap is a stub` → the single structural blocker to *any* real agent operation. Every domain's actor-snapshot is wasted until a machine can authenticate. **Pull forward:** an ADR + minimal `service_credentials` issuance/rotation/revocation path (the table exists) — cheaper now than after admin features multiply. This is the literal first step of the North-Star.
2. `[NS][PERSP] the moderation safety pattern is not generalized` → agent-toggle + decision-snapshot + human-override live ONLY in moderation. Admin (the next operator role) and content-report have the snapshot but no autonomy bound. **Pull forward:** promote the pattern to a **cross-cutting "agent-operable action" contract** (ADR): every operator write = actor-snapshot + per-capability `agent_<domain>` toggle + a machine-readable reason + an override/supersede path. Do it before admin Slice 2-4 so it is designed in, not retrofitted.
3. `[NS][PERSP] decisions without machine-readable reason/state` → moderation has `reason_code`+`decision_note` (agent-legible). Transfer terminal reasons and content-report resolutions are freer-text/less structured. For an agent to *learn* operator behavior it needs structured reasons everywhere. **Pull forward (cheap):** a small reason-code lookup per operator decision surface, mirroring `moderation_reasons`.
4. `[WW][PERSP] the `views`/analytics signal is fragile at the anon tier` (finding above) → an agent-run business optimizes on metrics; the one irrecoverable metric is currently pollutable and proxy-sensitive. Trustworthy instrumentation is a prerequisite for agent-run *business* ops, not just moderation.

**Forward-development pulls, phased by cost-of-change:**
- **Now / cheap (avoids rewrite):** agent-auth issuance ADR (#1); the cross-cutting agent-operable-action contract (#2) before admin Slice 2; view-count off the ETag/concurrency basis (structural, gets more expensive once discovery caching ships).
- **Next slice:** transfer-expiry worker (reuse the SLA-tick pattern); notification batching; N-1 write-compat rule into the DB DoD.
- **Deferred but reserved:** structured reason-codes on transfer/report; anon-viewer identity decision.

---

*Scope note:* inspected schema + migrations 0001–0034 + listing/moderation/notification/transfer/favorite/
auth code + ADRs 0006/0011/0013/0014/0015/0016/0018/0021/0022. `trust proxy`/XFF config, the exact
notification worker concurrency, and the frontend surface are **requires manual verification**. No product
code or docs modified; wrote only this file — no commit.
