# ZooLink HYPER Audit — Phase 2 · security (appsec authority, forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** independent threat-model +
white-hat re-verification of the IDOR/authz posture active-user certified, then attacked the named
seams against real code (controllers + services + guards + CASL + crypto + migrations/schema), not
the stale 2026-06-30 audit. Grounded in ADRs 0006/0011/0012/0016/0019.

Finding format: `[severity][criterion][security] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ idor · authz · xss · token-exfil ·
toctou · abuse · exposure · pii · hardening · forward-compat · positive.

---

## Headline verdict — IDOR posture HOLDS, with ONE genuine break

I independently re-ran active-user's IDOR certification and tried to break it. **The 404-no-leak /
object-level-authz model holds across the listing, saved-search, analytics and animal-*list* surfaces**
— and one READ endpoint breaks it:

**Confirmed solid (positive):**
- `listing.service.ts:155` server-derived `seller_id` (body `sellerId` ignored); `:169` server-forced
  `status=DRAFT` — client cannot self-approve or spoof ownership.
- `getById` (`:200`), `revealContact` (`:447`), `getAnalytics` (`:600`), `listPhotos` (`:885`) all
  collapse non-owned/non-active to **404 NOT_FOUND** — no existence leak (L-5).
- `list` scope is **AND-intersected** (`animal.service.ts:273-274`, listing `listScope`) — a spoofed
  `owner_id`/`seller_id` filter narrows, never widens; cross-principal enumeration blocked.
- TOCTOU single-winner via **status-guarded `updateMany` + count check** (markSold `:545`, submit `:369`,
  withdraw `:408`, re-enqueue `:303`) — concurrent mutations have exactly one winner.
- Parameterized SQL everywhere (`Prisma.sql` bound params, `:686-693`; `marketOf` `${animalId}::uuid`) —
  no injection surface found.
- Refresh **rotation + reuse-detection** built and correct (`refresh-token.service.ts:60-92`): presenting
  a revoked/rotated token burns the whole family. `erase_user` is **complete** (`admin-user.service.ts:203-250`):
  nulls phone_hash/oauth/email/email_bidx/contact_*, tombstones full_name, redacts notification_logs,
  revokes sessions, audits. `setRole` revokes all refresh families (`:117`). These earn a GO.

**The break:**

`[MAJOR][idor][security] backend/src/modules/animal/animal.service.ts:168 → getById does findOrThrow (404 if absent) → assertCan('read') which, per ability.factory.ts default case, grants USER NO unconditional Animal read (only manage on owner_id==uid) → reading another user's EXISTING animal returns 403 FORBIDDEN, an absent id returns 404 → existence oracle that violates the codebase's own 404-no-leak invariant (which listing/saved-search honour). The inline comment "Read authz is open to all roles (matrix)" is false. → on read-authz failure collapse to 404 NOT_FOUND (mirror canSeeNonActive/L-5). Exploitability LOW today (UUIDv4 ids unguessable) but it is a real invariant break AND the forward-compat drift signal: two objects, two different no-leak choices.`

(Note: listing WRITE paths — update/withdraw/submit/markSold/removePhoto — also return 403-not-404 for a
non-owned id via `assertCanMutate`; standard for mutations, accepted, but same drift root: see FC-1.)

---

## Named seams — verified

`[MAJOR][xss][security] backend/src/modules/identity/dto/identity.dto.ts:47,94,125 → avatarUrl validated only @IsString @MaxLength(500) on RegisterPhoneDto/OAuthDto/UpdateProfileDto; stored raw (identity.service.ts:98,215) → a javascript:/data:/"><img onerror> payload persists and is served in the user/seller projection (toUserProfile, admin toUserRoleInfo:102, reveal sellerName) → stored-XSS the moment the FE renders it as <img src>/<a href>. ADR-0019 T3 EXPLICITLY says avatar_url is "handled by @IsUrl validation + anti-XSS output encoding" — the @IsUrl is NOT implemented. → add @IsUrl({require_protocol:true, protocols:['http','https']}) on all three DTOs + output-encode on render. Confirms alpha-analyst's flag.`

`[MAJOR][token-exfil][security] backend/src/modules/auth/auth.controller.ts:33 (+ dto/auth.dto RefreshTokenDto, LogoutDto) → the refresh token is accepted in and returned via the JSON body, so the client must store a long-lived (JWT_REFRESH_TTL, ~7d) credential in JS-reachable storage → any XSS (e.g. the avatarUrl vector above) exfiltrates it = full account takeover surviving access-token rotation. Rotation+reuse-detection limits blast radius only if the LEGIT client rotates first; an attacker who rotates first wins and the victim gets logged out. → deliver/accept the refresh token as an httpOnly+Secure+SameSite=strict cookie (keep the body path behind a native-client flag). Contract change → route to alpha-analyst/architect. Confirms alpha-analyst (code+contract).`

`[MINOR][toctou][security] backend/src/modules/auth/refresh-token.service.ts:78-90 → rotate() reads the row (revoked_at==null) then updates BY ID unconditionally and creates the successor; two concurrent requests presenting the SAME token both pass the null-check (Prisma default READ COMMITTED) and each mint a new family — neither trips reuse-detection. This is the ONE place the "single-winner" guard used elsewhere (markSold/submit) is missing. → make rotation atomic: updateMany({where:{id, revoked_at:null}, data:{revoked_at:now}}) and treat count!==1 as reuse → revokeFamily. Low likelihood (needs same-token concurrency) but it defeats a security control, so fix.`

`[MINOR][hardening][security] backend/src/modules/auth/token.service.ts:23 + auth.module.ts:28-36 → verifyAccess calls jwt.verify with no options and JwtModule sets no verifyOptions.algorithms → the accepted algorithm set is not pinned to ['HS256']. Current real exploitability is LOW (only a symmetric secret is configured, so RS256→HS256 confusion has no public key to abuse, and jsonwebtoken rejects alg:none for a non-empty secret) — but pin explicitly as defense-in-depth. → add { algorithms: ['HS256'] } to verify (and verifyOptions in the module). Confirms the flagged seam; downgraded to MINOR after verifying the symmetric-only config mitigates the classic confusion.`

`[MAJOR][exposure][security] backend/src/lib/metrics/metrics.controller.ts:7-10 → GET /metrics is @Public + @SkipThrottle → Prometheus scrape is world-readable if the port is internet-reachable, leaking internal counters, route/label cardinality and business volumes (registrations, reveals, listings) for recon/competitive intel. → bind metrics to an internal-only interface or gate behind an ops credential / network policy; do not rely on the path being unadvertised. Whether the deploy topology already isolates it = требует ручной проверки (devops); if isolated, downgrade to INFO.`

`[MAJOR][authz][security] backend/src/modules/auth/auth.controller.ts:62-66 + config/env.validation.ts:8 → /auth/dev-token mints a full session for ANY user id and is gated ONLY by config.isProduction, i.e. NODE_ENV==='production'; the validator DEFAULTS NODE_ENV to 'development'. A prod deploy that forgets to set NODE_ENV leaves this master-key endpoint LIVE → arbitrary-user account takeover. Fail-open default on a master-key route. → gate dev-token behind an explicit ENABLE_DEV_TOKEN flag defaulting false (independent of NODE_ENV), or remove the NODE_ENV default so the env must be declared. (oauth.registry.ts:25 shares the same isProduction gate.)`

`[INFO][pii][security] database_schema.sql:111-112,970 + identity.service.ts:96 → ADR-0019 form IS built: email = AES-256-GCM ciphertext + HMAC email_bidx blind index (searchable equality), CryptoService seam with versioned enc:v1: prefix + KMS/СКЗИ swap-point. contact_phone column is TEXT/ciphertext and the reveal path decrypts (listing.service.ts:472); erase clears it. GOOD. Residual: OD-1 (contact_phone field-encrypted before launch) is go-live-blocking but currently UNVERIFIABLE — there is NO write path that sets contact_phone (active-user #1), so the encrypt-on-write half is latent. When the /me contact-set path lands it MUST route through crypto.encrypt (the decrypt side already assumes ciphertext). Reserve as a launch-gate check.`

`[INFO][pii][security] identity.service.ts:93,210 → full_name stored PLAINTEXT. This is ADR-0019 Tier-T2 (staged behind the seam, backlog-tracked) — a documented, owner-ratified accepted risk, NOT a new finding. Noted for the launch-floor: storage-level/volume encryption (ADR-0019 §3, devops) must cover it at rest.`

---

## Abuse economics (Phase-1 → real-world exploitability rating)

`[MAJOR][abuse][security] backend/src/modules/listing/listing.service.ts:504-528 → contact-reveal rate limit is keyed contact-reveal:{market}:{viewerId} — per-ACCOUNT only, no per-listing / per-seller cap, no account-age or verification-tier gate. Sybil reset: a fresh account restores the quota → an enumerator scrapes every seller's phone across N throwaway accounts. Registration is phone-OTP, which raises the Sybil cost to "one phone number per account" — a REAL but surmountable barrier (SMS-activation services cost pennies). Real-world exploitability: LOW today (channels return empty — active-user #1) → MEDIUM the moment contact_phone is populated. → add per-listing AND per-seller reveal caps + a min-account-age / verification gate before reveal.`

`[MAJOR][abuse][security] backend/src/modules/listing/listing.service.ts:130 → no per-user listing-creation quota (only uq_active_listing = one-active-per-type-per-animal + max 10 photos). Create N animals → N listings → flood a breed/city with near-dupes. The ADR-0003 pre-moderation gate catches published spam but the flood still consumes moderator capacity = DoS-by-moderation-queue. Real-world exploitability: MEDIUM. → per-user active-listing cap + creation throttle (route the quota value to architect/product).`

**Rating summary:** neither abuse vector is a today-impact break (contact channels are empty, moderation
pre-gates publish), but both are pre-existing STRUCTURAL gaps that go live the day contacts populate /
moderation is load-tested. Sybil-reveal = MEDIUM; listing-flood = MEDIUM; both LOW today.

---

## FORWARD-COMPAT authz verdict

**Does the object-level-authz model extend cleanly to every new ecosystem object?** — *In principle yes,
structurally at-risk.* The pattern `findRow → assertCanMutate / canSeeNonActive → 404-no-leak` is sound
and repeatable, and ADR-0016 rule 2 formally reserves "authz resolves through the backing principal;
404-no-leak per object" for offering/booking/order/verification-doc. **But:**

`[MAJOR][forward-compat][security] animal.service.ts:388 vs listing.service.ts:961/969 → the object-authz + no-leak logic is COPY-PASTED per module and already DIVERGED: animal getById chose 403, listing getById chose 404 (see the headline break). With ServiceOffering, bookings, orders and expertise documents about to multiply the object count (ADR-0014/0016), each new module will re-derive no-leak by hand and one WILL get it wrong (animal already did). IDOR is named the #1 recurring risk precisely because there is no single enforcement point. → extract a shared object-authz base (loadOrThrow + assertOwnerOrOperator + no-leak-collapse) BEFORE the ecosystem objects land; make 404-no-leak the default, not a per-author choice.`

`[MAJOR][forward-compat][security] backend/src/lib/auth/ability.factory.ts:51 + agent-service-token.authenticator.ts → agent-as-principal is source-agnostic at AUTHENTICATION (gated stub returns null; principal shape carries principal_type; AGENT subject to the same matrix — ADR-0006/0011 ready). But AUTHORIZATION is NOT least-privilege for AGENT: an AGENT principal is scoped only by its ROLE, so an AGENT with role=ADMIN inherits can('manage','all'). For the AI-expertise/provider side (ADR-0016 AGENT-tier: least-privilege + human-override on issuance), authority must come from SCOPED service_credentials + a narrower per-agent ability, not from reusing a human role grant. → reserve an agent-scope dimension in AbilityFactory now (form) so AI providers cannot be over-privileged when the gate opens; keep human-override on document issuance server-enforced.`

`[INFO][forward-compat][security] ADR-0016 risk-tiered provider verification (the Regime-2 immunity condition) → NO verification table/column exists yet; correct per ADR (form ships with ADR-0014 when the services side is built). The four DoD gates it reserves — object-level authz/404-no-leak, XOR-backing DB CHECK (mirrors chk_animal_ownership), server-side regulated-publish hard-gate (tier × category × market_scope), append-only tamper-proof verification — are the security-owned invariants for that seam. Flag as RESERVED-AND-OWNED: the publish gate MUST be server-side (never UI-only) and the verification record append-only. No code owes it today.`

**Verdict:** the authz *pattern* is forward-compat-ready; the *implementation discipline* is the risk —
no shared enforcement point (proven by the animal-vs-listing 403/404 drift), and no least-privilege
authorization dimension for AGENT principals yet. Fix both before the ecosystem object count multiplies.

---

## Security probes (concrete attack cases for Phase-3 to run)

> Runnable against the `backend` build via `/auth/dev-token` (dev) or phone-OTP. Format: **probe → steps → expected (secure) vs predicted (actual)**.

**A. Object-level authz / IDOR matrix (per object).**
1. **Animal getById 403-vs-404 oracle.** A creates animal X; B `GET /v1/animals/{X}` and `GET /v1/animals/{random-uuid}`. Expected(secure): both 404. Predicted: **403 for X, 404 for random → existence oracle (FAIL the invariant).**
2. **Listing no-leak read matrix.** A creates DRAFT listing L; B `GET /v1/listings/{L}`, `GET /v1/listings/{L}/photos`, `GET /v1/listings/{L}/analytics`, `POST /v1/listings/{L}/contact-reveal`. Expected: 404 throughout. (Certifies L-5.)
3. **Listing write-path oracle.** B `PATCH/DELETE/POST submit,mark-sold` on A's DRAFT L. Expected: 403 (accepted for mutations) — record that it differs from read-path 404 (drift signal for FC-1).
4. **Saved-search cross-user.** A creates SS; B `GET/DELETE /v1/saved-searches/{SS}`. Expected: 404 no-leak.
5. **List-scope widening.** B `GET /v1/animals?owner_id={A}` and `GET /v1/listings?seller_id={A}&status=DRAFT`. Expected: empty/only-ACTIVE — the spoofed filter must NOT widen scope.

**B. Enumeration / oracle.**
6. **Animal id enumeration.** Loop `GET /v1/animals/{uuid}` over known vs random ids; assert response code cannot distinguish existence (currently CAN — fix target).
7. **Public seller enumeration.** `GET /v1/listings?seller_id=X` unauth — expected only ACTIVE rows, no private-state leak.

**C. Sybil / abuse.**
8. **Contact-reveal Sybil reset.** Buyer B reveals to pet cap (10/h) → 11th = 429+Retry-After. Register buyer C (new phone), reveal SAME listing → succeeds. Expected(secure): per-seller/per-listing cap should also bite → demonstrates the Sybil reset gap.
9. **Listing flood.** One user loops create 50 animals → 50 listings. Expected(secure): a cap/429 after threshold. Predicted: all succeed → moderation-queue DoS surface.

**D. Token / session.**
10. **Refresh reuse-detection.** Rotate token T1→T2, then replay T1. Expected: 401 + whole family revoked (T2 also dead). (Certifies the control.)
11. **Refresh rotation race (TOCTOU).** Fire 2 concurrent `POST /auth/refresh` with the SAME token. Expected(secure): exactly one succeeds, the other 401+family-burn. Predicted: **both may mint families (race) — proves the missing atomic guard.**
12. **JWT algorithm pin.** Craft a token with alg=none and with alg swapped; present to any authed route. Expected: 401 both. (Confirms the symmetric-secret default holds even without an explicit pin.)
13. **dev-token exposure.** With NODE_ENV unset, `POST /auth/dev-token {userId: <any>}`. Expected(secure): 404. Predicted: **200 + full session → arbitrary-user takeover (fail-open default).**

**E. Injection / stored-XSS.**
14. **avatarUrl stored-XSS.** Register/PATCH profile with `avatarUrl: "javascript:alert(1)"`, then `"\"><img src=x onerror=alert(1)>"`. Expected(secure): 400 (IsUrl reject). Predicted: **accepted + stored**; then reveal/admin/profile render → XSS fires. Chain with probe 10/11 to show refresh-token exfil.
15. **SQL injection on discovery.** `GET /v1/listings?nickname=' OR 1=1--` / crafted species_id/breed_id. Expected: parameterized → literal match / 400, no injection. (Confirms Prisma.sql bound params.)

---

*Scope note:* deployment isolation of `/metrics`, the FE render/encoding of avatarUrl, and devops
storage-level encryption (ADR-0019 §3) are `требует ручной проверки` — I audited backend code +
schema + ADRs only. No product code or docs modified; this file is my sole output. **Gate stance:**
GO with required controls on the auth/refresh/erase core; the avatarUrl-XSS + refresh-in-body pair and
the dev-token fail-open default are the must-fix-before-outward items.
