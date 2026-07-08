# AUDIT4 — HYPER³ round-3 hardening synthesis (re-audit + new axes + trash-test + strategic lens)

> **Round-3 of the ZooLink cross-team audit.** Branch `backend`, HEAD `0fcc182`, all 18-role team
> (12 spawned for backend-hardening focus; ux/ui/frontend deferred — frontend deploys on a separate
> track, no new backend UI surface). Four lenses: **(1) same axes re-derived + reconciled vs round-1
> (`AUDIT2*`) and round-2 (`AUDIT3*`), (2) NEW axes** (concurrency/perf/resilience/migration-replay/
> agent-principal/economics/i18n), **(3) TRASH-TEST** (chaos/adversarial), **(4) STRATEGIC** (North-Star
> agent-run readiness · win-win needs-coverage · forward development). Per-role detail: `AUDIT4/<role>.md`.
> **Baseline floor re-proven this session: 610 unit + 289 e2e + 9 todo GREEN, ZERO RED; market grep-gate green.**

Launcher: `NEXT_SESSION_HYPER_TEST_PROMPT_V3.md` (v3.5). Fix-program context: `zoolink-audit3-fix-program-2026-07`.

---

## 0. Headline (what round-3 found that a green suite masked)

The Waves A–G fix-program is **real and holds** — round-3 independently **FIXED-VERIFIED** the round-2
blockers under adversarial input (contact-reveal alive, consents ФЗ-152-correct, notification consumer
live, dev-token fail-closed, avatarUrl-XSS dead, media host-allowlist survives `@`/IDN/port tricks,
market 3-site breach closed, favorites shipped). **No regression to the honest-green baseline.**

But round-3's mandate — *stress the fixes, judge the platform against the business apex* — surfaced
**one fix that broke an adjacent flow, several scale/concurrency defects a happy-path suite can't see,
and a strategic gap that is bigger than any single bug**:

- 🔴 **A fix closed the only photo path (B-1).** The AUDIT3 media host-allowlist (good SSRF defence)
  now requires photo URLs on the own CDN host — but **no endpoint issues a seller an upload URL**
  (`s3.adapter.presignedPut` exists, wired to nothing). Real sellers cannot add a photo. *Verified in code.*
- 🔴 **View-count write-on-read is architecturally toxic.** `listings.update`(+1) on every public GET
  bumps `updated_at` → busts the ETag it is derived from → sellers get **spurious 412 `If-Match`
  edit-lockouts** + hot-row contention + a DoS/grief chain. *Verified: ETag = `weakEtag(id, updated_at)`.*
- 🔴 **The strategic verdict (converged across active-user/psychologist/architect/growth):** the built
  marketplace is a **one-way contact-reveal that leaks the relationship to Telegram** — no reputation/
  review primitive, no buyer-confirmed sale. **The platform captures none of the value and therefore
  cannot become agent-run** (North-Star) and **tilts win-win toward sellers** (demand has no return loop).

---

## 1. Reconcile — round 1 ↔ 2 ↔ 3 (FIXED-VERIFIED highlights)

The fifth category (**FIXED-VERIFIED** = the fix truly closed it, not green-masked) was the point of
round-3. Independently confirmed closed:

| Area | round-1/2 finding | round-3 verdict | Verified by |
|---|---|---|---|
| Contact-reveal dead marketplace | BLOCKER (empty channels) | **FIXED-VERIFIED** — real channels, dedup, empty→NO_CHANNELS no-charge | active-user, backend, finance |
| Zero-consumer outbox | Events produced, never consumed | **FIXED-VERIFIED** — `NotificationConsumer` live, producer↔consumer parity | reviewer-qa, backend |
| Consent / ФЗ-152 | No consent-of-record | **FIXED-VERIFIED** — append-only `consents`, ст.9/10.1, default-deny | legal, psychologist |
| dev-token bypass | Auth bypass risk | **FIXED-VERIFIED** — fail-closed, NODE_ENV=production default | security |
| avatarUrl-XSS × refresh-in-body | Exfil chain | **FIXED-VERIFIED** — `@IsUrl` https-only + HttpOnly/SameSite=Strict cookie | security |
| Media host bait-and-switch / SSRF | Photo-swap after moderation | **FIXED-VERIFIED** — own-host allowlist survives `@`/IDN/port | security, active-user |
| ADR-0018 market 3-site breach | Raw `animals⋈species` joins | **FIXED-VERIFIED** — derived cache, CI grep-gate | architect, reviewer-qa |
| RF-residency P0 (ADR-0017) | 2-round blocker | **FIXED-VERIFIED** — 3-layer guardrail + blocking CI | devops |
| Claim-code enum-oracle | Transfer counterparty leak | **FIXED-VERIFIED** — atomic single-use | security, backend |
| favorites / view-count dead-features | Built-but-unwired | **FIXED-VERIFIED** — controller + capture live | active-user, growth, data |

**Net:** ~8 security fixes + 6 marketplace-revival fixes verified genuine. The fix-program did its job.

---

## 2. Consolidated findings — prioritized P0–P4

Severity = product impact × likelihood, reconciled across roles (a finding raised by ≥2 independent
roles is marked **⇊converged**). All fixes below are **owner-gated** (commit only on explicit request);
several are product-src changes that must land as **separate gated slices**.

### P0 — blocks a core user journey / data-safety (fix first)
| # | Finding | File:line | Roles | Verdict |
|---|---|---|---|---|
| P0-1 | **Photo-upload path dead** — host-allowlist requires own-CDN URL, no presign/upload endpoint exists → sellers cannot add photos | `listing.service.ts:1066` (`assertOwnMediaHost`) + missing controller for `s3.adapter.presignedPut` | active-user, security ⇊converged | **CONFIRMED (code-verified)** NEW |
| P0-2 | **View-count write-on-read → ETag/If-Match 412 lockout + hot-row** — every public GET bumps `updated_at` | `listing.service.ts` captureView + `:1202` weakEtag | architect, backend, data ⇊converged | **CONFIRMED (code-verified)** NEW |

### P1 — correctness / concurrency / security integrity
| # | Finding | File:line | Roles | Verdict |
|---|---|---|---|---|
| P1-1 | **Claim-code burned before tx** — SELF_TRANSFER / P2002 destroys the single-use code with no transfer created | `transfer.service.ts:161` | backend | CONFIRMED NEW |
| P1-2 | **Consent tie-break fails OPEN** — `orderBy created_at DESC, id DESC`; same-ms rows → random UUID decides → withdrawal can lose (ФЗ-152) | `consent.service.ts:66` | security, backend ⇊converged | **CONFIRMED-narrow (code-verified)** NEW |
| P1-3 | **Refresh rotate-TOCTOU un-atomic** — stolen-cookie replay is now the sole exfil path | identity refresh path | security | CONFIRMED SEV-CHG |
| P1-4 | **No listing-creation quota** — only Idempotency-Key; supply-flood / Sybil poisons per-city liquidity + moderation-queue DoS, invisible | `listing.controller.ts` POST | data, growth, security, active-user ⇊converged×4 | CONFIRMED NEW |
| P1-5 | **N-1 rolling-deploy unsafe** — `0033 market NOT NULL` no DEFAULT, `0028` email-ciphertext, `0029` unique break old pods mid-migrate | migrations 0028/0029/0033 | devops, architect, reviewer-qa ⇊converged | CONFIRMED NEW |
| P1-6 | **`[NS]` AGENT scoped by human role only** — AGENT+ADMIN inherits `manage:all`; no scoped-ability seam → any agent operator-power unsafe | ability.factory | security, architect ⇊converged | CONFIRMED NEW (→ ADR) |

### P2 — resilience / masking / spec-drift
| # | Finding | File:line | Roles | Verdict |
|---|---|---|---|---|
| P2-1 | **Outbox `attempts++` at lease not delivery** — crash-loop/PG blip dead-letters HEALTHY events invisibly | `outbox.relay.ts:83` | backend, devops ⇊converged | CONFIRMED NEW |
| P2-2 | **Advisory-lock on pooled client** — acquire/unlock hit different connections → lock can wedge at worker-scale | `advisory-lock.ts:41` | devops | CONFIRMED NEW |
| P2-3 | **Migration-drift CI replays on empty tables** — backfill-then-`SET NOT NULL` (0028/0032/0033) proven only where backfill is a no-op | CI drift-gate | reviewer-qa | CONFIRMED NEW (masking) |
| P2-4 | **consents append-only never proven** — tests only disable the trigger; no UPDATE/DELETE-rejected assertion | test suite | reviewer-qa | CONFIRMED NEW (masking) |
| P2-5 | **Notification spec-drift** — ADR-0021 promises Listing/report events; registry has only Moderation+Transfer; IN_APP write-only (no `/me/notifications` read, absent from contract enum) | `notification.registry.ts`, event-catalog | alpha-analyst | CONFIRMED NEW (drift) |
| P2-6 | **Transfer 72h expiry lazy-on-read** — built notification path starved; needs a sweeper (SLA-tick pattern exists) | transfer expiry | architect, backend, psychologist ⇊converged | CONFIRMED NEW |
| P2-7 | **Idempotency-Key unbounded** — Redis-fill resource exhaustion | idempotency interceptor | security | CONFIRMED NEW (trash) |

### P3 — strategic-debt / trust (weight like bugs per owner's win-win law)
| # | Finding | Roles | Lens |
|---|---|---|---|
| P3-1 | **No reputation/review/confirmed-sale primitive** — one-way reveal leaks to Telegram; platform captures no value | active-user, psychologist, growth ⇊converged | `[WW][NS]` |
| P3-2 | **Demand has no return loop** — saved-search store-only (no notify), no reverse-Request → win-win tilts to sellers | growth, active-user | `[WW]` |
| P3-3 | **`vet_leadgen` toggle EXTRACTIVE** — routes grief/health-anxiety owner to highest bidder; reshape the *form* now | psychologist, finance ⇊converged | `[WW]` |
| P3-4 | **`boosted_listings` RISKY** — pay-to-win ranking on impulse live-animal buy; harms cold-start | psychologist, finance, growth ⇊converged | `[WW]` |
| P3-5 | **Machine-ops signal absent for agents** — `/metrics` Node-defaults only, worker no /health; no queue-depth/outbox-lag/dead-letter/SLA | devops | `[NS]` |
| P3-6 | **Abuse/anomaly event family missing** — AI moderator has no machine signal for view-inflation/Sybil/flood | data-analyst | `[NS]` |

### P4 — record-only (owner-deferred to near-release) / minor
- Legal: `eraseUser` no consent-withdrawal row (ст.9 ч.2 hygiene); `policy_version='1.0'` bare constant until go-live text frozen; standing gates (residency, publish, CITES) CONFIRMED-deferred.
- Finance: no boost/subscription/lead ledger → those money-integrity invariants undefined (only when a paid toggle is designed).
- Buyer-facing view-count could create false urgency (psychologist) — only if surfaced in Phase-2 UI.
- GAP-BA-001 livestock price-terms + notif-prefs VET/GROOMER = CONFIRMED-open from prior rounds.

---

## 3. TRASH-TEST results (what withstood, what did not)

| Surface | Adversarial input | Result |
|---|---|---|
| Media host-allowlist | `@`-tricks, IDN/unicode-host, port, redirect | **HELD** — allowlist robust |
| Claim-code | double-consume, enum-oracle | **HELD** (atomic single-use) — but burns on failed tx (P1-1) |
| dev-token | weird NODE_ENV | **HELD** — fail-closed |
| Refresh cookie | replay of stolen cookie | **PARTIAL** — rotate-TOCTOU un-atomic (P1-3) |
| Consent opt-in/withdraw race | same-ms rows | **FAILS OPEN** (P1-2) |
| `POST /listings` | flood / Sybil | **NO QUOTA** (P1-4) — supply-flood open |
| view-count | IP-rotation inflation | **INFLATABLE** — scalar, no per-view record (P0-2 chain) |
| Idempotency-Key | unbounded keys | **Redis-fill** (P2-7) |
| priceCents | BIGINT overflow | **500** — no `@Max` (boundary) |
| Dependency-failure (Redis/PG mid-tx) | kill mid-op | Degrades but: outbox dead-letters healthy (P2-1), throttler fail-closed 500s undocumented |
| IDOR / object-level authz | cross-tenant reads | **HELD** — `assertCanReadOrNotFound` parity solid |

**No 5xx-with-leak, no authz/market-separation bypass, no data-corruption found.** The failures are
availability/correctness/quota-integrity, not confidentiality breaches. Backend core = **GO-with-controls**
for internet deploy (security).

---

## 4. STRATEGIC section (v3.5 lens — judged against the business apex)

### 4a. Agent-runnability scorecard (→ North-Star: agent-run future, ADR-0006)
| Domain | Verdict | Note |
|---|---|---|
| **moderation** | **READY** | Reference impl — agent-toggle + snapshot + human-override built (mig 0011/0016) |
| **transfer** | SEAM-NEEDED | Agent-principal paths exist; expiry sweeper + notification wiring needed |
| **identity/consent** | SEAM-NEEDED | On-behalf consent needs scoped-ability; consent lifecycle unspecced |
| **admin** (declared next operator role) | **SEAM-NEEDED** | No autonomy-gate pattern yet — needed before Admin Slice 2 |
| **content-report** | SEAM-NEEDED | Lacks the autonomy-gate pattern |
| **listings / favorites** | SEAM-NEEDED | Programmatic paths OK; abuse-quota + machine-signal missing |
| **— agent-auth bootstrap —** | **BLOCKED** | `service_credentials` issuance is a stub; **the single structural blocker to ALL autonomy** |
| **— scoped-ability —** | **BLOCKED** | AGENT inherits human-role `manage:all` (P1-6); no per-agent scope/rate/blast-radius |

**The two BLOCKED rows gate the entire North-Star.** Until agent-credential issuance + scoped-ability
land (an ADR each), an agent operator is either powerless (no creds) or over-powered (inherits admin).
Legal spine confirmed: **ст.16 ФЗ-152** (solely-automated decisions) — override machinery already built;
what's missing is the *consumer surface* (explanation/right-to-object/disclosure) + the fact that the
**agent is not a legal person — the registered operator bears all liability.**

### 4b. Needs-coverage map (→ win-win: close the real need, both sides win)
| Persona / market side | Real need | Surface | Status | Close it with |
|---|---|---|---|---|
| Pet seller / breeder | List + get reachable buyers | listings + reveal | **PARTIAL** | Fix P0-1 (photos), P2-6 (expiry) |
| Pet buyer | Find + safely contact + trust seller | discovery + reveal | **PARTIAL** | Reputation (P3-1), return loop (P3-2) |
| Livestock seller | List with livestock price-terms | listings | **PARTIAL** | GAP-BA-001 price-terms |
| Livestock buyer | Discover + contact | discovery + reveal | **PARTIAL** | Same return-loop gap |
| Vet / groomer / walker / sitter | Offer a service | — | **GAP** | Service offering surface (roles junction dormant) |
| Goods seller | Sell accessories/feed | — | **GAP** | goods_marketplace (reserved) |
| Shelter / org | Multi-user org listing | — | **GAP** | Org-create + active multi-role |

**Win-win verdict:** supply-side complete, **demand-side return-incomplete → tilts to sellers.** The
*built* mechanics are clean (no live extraction); the risk is entirely in the **reserved toggles**
(vet_leadgen EXTRACTIVE, boosted_listings RISKY — reshape their forms now, weight like bugs). The
**one-way reveal (P3-1) is the deepest win-win + North-Star gap**: without a two-sided trust/confirmed-sale
primitive the relationship (and value) leaves the platform, so neither the win-win loop nor agent-operation
can close.

### 4c. Forward-development plan (perspective, phased by cost-of-change)
**Pull forward NOW (cheaper than after Phase-2 frontend / monetization / scale):**
1. **P0-1 photo-upload endpoint** — frontend deploy will hit this immediately; blocks every seller.
2. **P0-2 view-count off the entity row + off the ETag basis** — an ADR; the write-on-read is a scale trap that only worsens with traffic.
3. **P1-5 N-1 migration-safety + deploy-order runbook** — before the first real rolling deploy.
4. **P1-6 + agent-auth ADRs** — the North-Star's two structural blockers; cheapest to design before Admin Slice 2 hard-wires human-only.
5. **P3-2 saved-search→notify** — infra now ready (notification consumer live), low effort, opens the demand return-loop.
6. **P3-1 reputation/confirmed-sale primitive** — the highest-leverage win-win + agent-run enabler; design the *form* now even if behavior phases in.

**Honestly deferred (owner-confirmed):** monetization model + pricing (soft-start, discuss first), legal
publish/РКН/secret-rotation/RF-zones, service/goods/org surfaces (post-MVP), 8/9 `it.todo` (unbuilt
Offering/find-nearby/reviews/verification/booking/progressive-role).

**Dead-ends / anti-patterns to stop:** buyer-facing view-count urgency; any paid mechanic before the
trust primitive exists (would be extraction, not win-win).

---

## 5. Method & discipline notes
- Baseline floor re-proven GREEN before any conclusion (610u/289e+9todo, market grep-gate green).
- No product src changed, no commit made (owner-gated). Trash-cases are designs for Phase-3 test files.
- P0-1, P0-2, P1-2 **code-verified by the orchestrator** this session (not agent-reported only).
- ux/ui/frontend roles deliberately not spawned (frontend on separate deploy track; no new backend UI surface) — recorded, not skipped.
- Per-role full findings + round1↔2↔3 diffs: `AUDIT4/<role>.md` (12 files).

## 6. Recommended next step (needs owner go-ahead — involves commits)
**Phase 3 hardening is the natural continuation**, sequenced as gated slices:
1. **Slice H1 (P0):** photo-upload endpoint + view-count off entity-row/ETag basis + their negative/concurrency tests.
2. **Slice H2 (P1):** claim-code-in-tx, consent monotonic tie-break, listing-creation quota, N-1 migration-safety.
3. **Slice H3 (P2):** outbox attempts-on-delivery, advisory-xact-lock, real append-only + drift-on-populated-table tests, notification spec-reconcile.
4. **ADR track (P1-6/NS):** agent-credential issuance + scoped-ability — unblocks the North-Star.
5. **Strategic track (P3):** saved-search→notify, then design the reputation/confirmed-sale primitive form.

Each slice: implement → live-PG + full suite gate → **stop for owner commit approval** (`always-ask-before-commit`).
