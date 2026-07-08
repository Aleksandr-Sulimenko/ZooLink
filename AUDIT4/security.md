# ZooLink HYPER³ Audit — Round 3 · security (appsec authority · Phase-2 re-attack + TRASH-TEST lead)

**Date:** 2026-07-08 · **Branch:** `backend` · **HEAD:** `0fcc182` · **Method:** independent
re-attack of the AUDIT3 findings against the **post-fix (Waves A–G)** code, adversarial stress of the
NEW surfaces the fix-program introduced (claim-code, refresh-cookie, JWT pin, media allowlist,
METRICS_TOKEN, dev-token fail-closed, consent-gate, animal 404), a trash/fuzz design pass, and a
strategic `[NS]` safe-autonomy lens on the agent-as-principal paths. Read real code (controllers,
services, guards, CASL, DTOs, crypto, env-validation, cookie/media/metrics libs), not the prior file.
**No product src modified; suite NOT run (shared baseline in use) — reasoning + case-design only.**

Format: `[severity][criterion][axis][state] file:line → problem/trash-case → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO · axis ∈ same|new|trash|strat · state ∈
NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED. Strategic findings carry `[NS]`.

---

## Headline — the two AUDIT3 CRITICAL chains are CLOSED, verified under adversarial input

`[INFO][authz][same][FIXED-VERIFIED] auth.controller.ts:95-120 + config/env.validation.ts:44-52 +
app-config.service.ts:30-31 → the AUDIT3 #1 CRITICAL dev-token fail-OPEN chain is closed. Two
independent locks, both fail-safe: (a) NODE_ENV `.default('production')` — a boot that FORGETS the
var lands locked-down, not permissive; (b) devToken is gated on `isDevTokenEnabled` = `ENABLE_DEV_TOKEN===true && !isProduction`, and ENABLE_DEV_TOKEN is a STRICT `z.enum(['true','false'])` default false (a typo '1'/'TRUE'/'yes' is a boot error, never silently truthy — the z.coerce.boolean footgun is explicitly avoided). Adversarial: a prod deploy with any/no NODE_ENV + any ENABLE_DEV_TOKEN value → devToken returns 404 (NotFound, no route-confirm). The arbitrary-account-takeover master key is dead.`

`[INFO][xss+token-exfil][same][FIXED-VERIFIED] identity.dto.ts:29,56,104,135 + refresh-cookie.ts +
auth.controller.ts:47-62 → the AUDIT3 #2 CRITICAL avatarUrl-XSS × refresh-in-body chain is closed at
BOTH halves. (a) All three avatarUrl DTOs now carry `@IsUrl({protocols:['https'],require_protocol:true})` — `javascript:`, `data:`, protocol-relative and plain http are 400-rejected before storage. (b) The refresh token is transported ONLY as an HttpOnly+Secure+SameSite=Strict cookie scoped to `/v1/auth` (least-privilege path); `/auth/refresh` reads it from the cookie, never the body — page JS cannot reach it, so an XSS cannot exfiltrate it. The XSS→refresh-exfil→operator-ATO chain no longer composes. Residual (below): stolen-cookie replay is bounded only by rotation, and rotation still has the AUDIT2 TOCTOU.`

---

## AUDIT3/AUDIT2 findings — re-verified against the fix

`[INFO][hardening][same][FIXED-VERIFIED] token.service.ts:25 → JWT verify now pins `{algorithms:['HS256']}` at the call site — alg-confusion / `alg:none` rejected regardless of module wiring. AUDIT3 #3 closed.`

`[INFO][exposure][same][FIXED-VERIFIED] lib/metrics/metrics.guard.ts:22-35 + env.validation.ts (METRICS_TOKEN prod-required) → /metrics is no longer @Public-world-readable. MetricsGuard is fail-CLOSED with 404-no-leak: token present → constant-time compare or 404; no token → internal-client (loopback/RFC1918) only, else 404. METRICS_TOKEN (≥16) is boot-REQUIRED in production, so prod cannot fall back to the IP heuristic. AUDIT2/3 MAJOR closed. Residual → see TRASH-M1 (XFF/trust-proxy).`

`[INFO][idor][same][FIXED-VERIFIED] animal.service.ts:182-186 → getById now collapses present-but-unauthorized to 404 NOT_FOUND (mirrors the row-level `ability.can('read',…)` check), identical to listing/saved-search/content-report. The AUDIT2/3 403-vs-404 existence oracle — the codebase's #1-risk recurrence — is closed on the READ path. (Mutations still 403 by design; accepted, standard.)`

`[INFO][abuse][new][FIXED-VERIFIED] lib/media/media-url.ts:40-49 + listing.service.ts:156-157 → listing photo URLs are now host-allowlisted to the S3/MinIO origin (+ optional MEDIA_CDN_HOST) via `new URL().host` exact-match, http(s)-only. Adversarial host tricks fail SAFE: `@`-userinfo (`https://cdn.zoolink.ru@evil.com`) → host=`evil.com`→reject; unicode/IDN → punycode host≠allowlist→reject; explicit non-default port → host carries `:port`→reject; `javascript:`/`data:`/`file:` → scheme reject. The moderation-swap + arbitrary-host storage hole is closed. Residuals below (SSRF-REDIR, http-on-CDN).`

`[INFO][abuse][same][FIXED-VERIFIED] transfer.service.ts:107,147 → the AUDIT3 transfer/claim-mint enumeration oracle is mitigated: `initiate` and claim-`mint` are now per-principal Redis rate-limited (429+Retry-After), throttling the raw-UUID 404-probe. Residual recipient-existence distinction stays LOW (UUIDv4).`

`[INFO][toctou][new][FIXED-VERIFIED] claim-code.service.ts:82-97 → transfer claim-code consume is atomic single-use: one Lua GET-then-DEL EVAL (Redis-6.0-portable), so two concurrent redemptions of one code cannot both win. Every miss mode (nonexistent/expired/consumed/malformed) returns `null` → one uniform 422, no existence/timing oracle. 80-bit Crockford entropy makes brute-force infeasible; mint is rate-limited (anti-spam). Solid.`

`[MINOR][toctou][same][CONFIRMED — does NOT escalate] refresh-token.service.ts:67-79 → rotate() still reads `row.revoked_at==null` then `update({where:{id}})` UNCONDITIONALLY (not the atomic `updateMany({where:{id,revoked_at:null}})`+count guard used in transfer/markSold). Two concurrent requests presenting the SAME token both pass the null-check under READ COMMITTED → each mints a family, neither trips reuse-detection. Cannot grant new access (attacker must already hold the token); it only lets a thief+victim race go UNDETECTED — weakens a detection control. With the refresh cookie now the sole transport this matters for stolen-cookie replay: fix so the FIRST legit rotation reliably burns a replayed steal. → make rotation atomic + treat count!==1 as reuse→revokeFamily.`

`[MAJOR][abuse][same][SEV-CHG ↑ likelihood] listing.service.ts:585,633-635 → contact-reveal rate-limit key is STILL `contact-reveal:{market}:{viewerId}` — per-ACCOUNT only, no per-listing / per-seller cap, no account-age/verification gate. Sybil reset via a fresh phone-OTP account restores the quota → scrape every seller's phone. AUDIT2/3 rated this LOW-today because contact_phone had no writer; that is NO LONGER TRUE — `profile.service.ts:61` now field-encrypts and PERSISTS `dto.contactPhone` (E.164-validated). The scrape target is live once sellers set a phone. Likelihood LOW→MEDIUM. → per-listing AND per-seller reveal caps + min-account-age/verification gate before reveal (value → architect).`

`[MAJOR][abuse][same][CONFIRMED] listing.service.ts (create path) → still NO per-user listing-creation quota (only `uq_active_listing` per animal-type + 10-photo cap). Create N animals → N listings → flood + moderation-queue DoS. → per-user active-listing cap + creation throttle.`

`[INFO][pii][same][CONFIRMED — improved] profile.service.ts:61 + listing.service.ts:554-558 → the ADR-0019 encrypt-on-write half is now REAL: contactPhone is `crypto.encrypt`-ed on write, decrypted only at a consented reveal. The AUDIT2 OD-1 latent-writer gap is closed. full_name plaintext = documented ADR-0019 Tier-T2 accepted risk (storage-level enc, devops) — unchanged. Launch-gate check.`

---

## NEW findings (round 3)

`[MINOR][consent-integrity][new][NEW] consent.service.ts:64-69 → `currentlyGranted` picks the current
consent by `orderBy:[{created_at:'desc'},{id:'desc'}]`. `id` is a random UUID, so when a grant and a
withdrawal share the SAME `created_at` (same-microsecond writes, e.g. a batched/on-behalf sequence or
concurrent grant+withdraw), the "latest" is decided by RANDOM UUID comparison — NOT causal order. A
withdrawal can LOSE the tie and the row resolve to `granted=true` after the subject withdrew — a
ФЗ-152 ст.9 ч.2 "withdrawal must take effect" break, and it fails OPEN (toward distribution). Window
is narrow (µs-precision timestamptz) but the tie-break must be fail-safe. → break ties toward
`granted=false` (deny wins), OR order by a monotonic BIGSERIAL sequence instead of the random UUID.`

`[MINOR][consent-toctou][new][NEW] listing.service.ts:554 → revealContact reads
`consent.currentlyGranted(seller,…)` then performs the reveal write in a later tx. A seller withdrawal
that lands in the check→act window still yields a completed reveal (+ persisted `contact_reveals` row
+ lead event). Once written, later dedup returns the row regardless of withdrawal. LOW impact (single
µs-scale window; arguably "already distributed" is defensible) but note it: the consent gate is not
transactionally coupled to the distribution write. → re-check `currentlyGranted` inside the reveal tx,
or accept as documented residual.`

`[MINOR][trash/exhaustion][trash][NEW] lib/http/idempotency.interceptor.ts:63 → the raw
`Idempotency-Key` header is used to build the Redis dedup key with NO length/charset bound found in
the interceptor or a DTO (unlike `claimCode` which is `@MaxLength(64)`). A flood of unique
multi-KB keys is a Redis-memory-fill / cost vector, and a huge key bloats every lookup. → cap the
accepted key (e.g. ≤128 chars, printable) and 400 on violation. *Header-cap at the edge (Caddy/body
limits) requires manual verification.*`

`[INFO][exposure][trash][NEW] metrics.guard.ts:53-54 (TRASH-M1) → `isInternalClient` trusts
`req.ip`/`socket.remoteAddress`. IF Express `trust proxy` is enabled and honours `X-Forwarded-For`,
a client could spoof `X-Forwarded-For: 127.0.0.1` to appear internal — but ONLY on a deploy with NO
METRICS_TOKEN, which prod forbids. Real risk is dev/staging only. → never enable `trust proxy` for the
metrics path, or rely solely on the token. *trust-proxy setting requires manual verification (devops).*`

`[MINOR][abuse][new][NEW] media-url.ts:47 (SSRF-REDIR / http-on-CDN) → the allowlist accepts BOTH
`http:` and `https:` for any allowed host, and validates only the STORED URL. Two latent residuals:
(1) once ANY server-side fetch lands (thumbnailing/safety-scan/link-preview), an allowed CDN host that
issues a 3xx redirect to an internal target would be followed → SSRF, because the allowlist gates the
first hop only; (2) a prod CDN entry permits `http://cdn…` (cleartext) media. → when a fetcher lands:
disable redirect-follow (or re-validate every hop) + require https for non-loopback allowed hosts.`

`[INFO][idor][same][CONFIRMED positive] saved-search / content-report / favorite / transfer view paths →
re-attacked; object-level authz still HOLDS (owner==actor, AND-intersected lists, guarded
deleteMany→404-no-leak, party-membership gates on transfer). Parameterized SQL throughout. No new
IDOR/injection break in the Phase-2 modules.`

---

## STRATEGIC — `[NS]` safe-autonomy bounds for agent-operators (ADR-0006 North Star)

`[MAJOR][forward-compat][strat][CONFIRMED][NS] lib/auth/ability.factory.ts:46-84 → an AGENT principal
is scoped ONLY by its human `role`; `case 'ADMIN': can('manage','all')` means an AGENT issued role=ADMIN
inherits PLATFORM-WIDE authority with NO agent-specific bound. For the North-Star (agents running
moderation/admin/business over time) this is the one structural blocker: an autonomous operator-agent
needs least-privilege scope, a blast-radius cap, per-action rate/scope limits, and an append-only audit
that a reused human-role grant does not provide. → **BLOCKED: do not grant any AGENT operator-power on
the current model.** Minimal safe seam: reserve an agent-scope dimension in AbilityFactory now (form) —
authority for AGENT principals derives from SCOPED `service_credentials` (ADR-0011 A0b, table exists,
gate off) + a narrower per-agent ability, never `manage:all`; keep human-override server-enforced.`

**`[NS]` safe-autonomy BLOCKED list (give an agent operator-power today = unsafe until the seam lands):**
1. **AGENT with elevated role** — no per-agent scope/blast-radius; `manage:all` inheritance (above). BLOCK.
2. **Agent-initiated contact-reveal / distribution** — no per-agent reveal budget; the per-account
   Sybil gap (above) + no agent rate-scope = an agent could mass-distribute PII. BLOCK until per-seller
   caps + an agent budget dimension exist.
3. **Agent-recorded consent (`consent.service` actorPrincipalType=AGENT)** — representable and audited,
   but the tie-break fail-OPEN (NEW above) + no agent-authenticity binding means an agent could record a
   consent that resolves against the subject's withdrawal. BLOCK on-behalf agent consent-writes until the
   fail-safe tie-break + agent-scope land.
4. **Agent moderation decisions** — append-only + human-override forms exist (migr 0016); safe to FORM,
   but do not enable autonomous moderation execution without a per-agent action-rate cap + escalation gate.

The agent-as-principal FORMS (principal_type, actor snapshots, service_credentials, human-override,
append-only audit) are correctly in place — the gap is the **least-privilege authorization + rate/scope
bound**, which is the single security precondition to unblock any agent operator-power.

---

## TRASH-TEST case list (Phase 3 to implement — surface → adversarial input → expected SAFE behavior)

**T1 · claim-code consume** — POST transfer `claimCode`: (a) already-consumed code twice → both/second = 422 `TRANSFER_CLAIM_CODE_INVALID`, exactly one animal actually transfers; (b) expired code → 422; (c) malformed `"I-L-O-U!!"`, empty, 10 000-char string → 422 (normalize→miss), no 5xx; (d) 64-char over-cap → 400; (e) concurrent-storm N× same code → exactly one 200, rest 422 (single-use single-winner).
**T2 · double-accept transfer** — 2 concurrent `respond ACCEPT` on one PENDING → exactly one 200/COMPLETED, other 409 `TRANSFER_NOT_PENDING`; one ownership-history row; no double re-attribution.
**T3 · refresh-cookie replay** — steal cookie, replay after legit rotation → 401 + family burned (T2' both dead). *Currently at risk via rotate-TOCTOU — assert the race: 2 concurrent same-cookie → exactly one succeeds + family burn.*
**T4 · concurrent consent grant/withdraw** — fire grant+withdraw at same instant, then read `currentlyGranted` → MUST resolve `false` (deny-wins tie-break), never random.
**T5 · concurrent favorite/unfavorite + double-reveal** — race add/remove favorite and 2× reveal same listing → idempotent; reveal dedups on `uq_contact_reveals_viewer_listing` → one row, one lead event, quota charged once.
**T6 · media-URL host bypass** — submit `https://cdn.zoolink.ru@evil.com/x.jpg`, `https://аdn.zoolink.ru` (IDN homoglyph), `https://cdn.zoolink.ru:8443/x`, `http://169.254.169.254/`, `javascript:`, `data:` → ALL 400 (host≠allowlist / scheme reject).
**T7 · dev-token fail-closed matrix** — {NODE_ENV ∈ unset/development/production} × {ENABLE_DEV_TOKEN ∈ unset/false/'1'/'TRUE'/true} → 404 for every combo except (development,true); the '1'/'TRUE' cases are BOOT errors.
**T8 · /metrics** — no token from a public IP → 404; wrong token → 404 (constant-time); spoofed `X-Forwarded-For:127.0.0.1` with no token → 404 (asserts XFF not trusted); prod boot with no METRICS_TOKEN → refuses to start.
**T9 · animal 404-no-leak** — B `GET /animals/{A-owned}` and `/animals/{random-uuid}` → both 404, indistinguishable (existence oracle closed).
**T10 · JWT tamper** — `alg:none`, RS256-swapped, tampered payload, expired → 401 for all.
**T11 · fuzz every string field** — null-byte, 1 MB string, deep-nested JSON, `' OR 1=1--`, `{{7*7}}`, `<script>` into fullName/reason/nickname/contactPhone/avatarUrl/email/claimCode → 400 VALIDATION_ERROR or literal-match (parameterized), never 5xx, never stored-executed. avatarUrl `javascript:`/`data:` → 400; contactPhone non-E.164 → 400.
**T12 · Idempotency-Key trash** — multi-KB key, binary/control chars, flood 10⁴ unique keys → capped/400 + bounded Redis memory (asserts T1-idempotency finding fix).
**T13 · malformed UUID / ETag / If-Match** — path `{id}=not-a-uuid`, `If-Match: "garbage"` on PATCH → 400/412/428, never 500 or authz bypass.
**T14 · pagination abuse** — `?limit=1000000&page=-1`, huge offset → clamped to max page size, no full-table scan / memory blowup.
**T15 · dependency-failure injection** — kill Redis mid contact-reveal / claim-consume, kill PG mid transfer-accept → deny/degrade (4xx/5xx-without-leak), NO partial ownership write, NO consent/market-separation bypass, NO PII in the error body. (Assert market-separation and 404-no-leak hold under failure.)
**T16 · market-separation under stress** — pet buyer against a livestock listing id and vice-versa across every read/reveal/favorite path → the derived-market cache (D3) must not let a cross-market reveal or scope-widen through.

---

## Diff vs AUDIT3/security.md
- **FIXED-VERIFIED (8):** dev-token fail-closed (CRIT#1), avatarUrl-IsUrl + refresh-cookie (CRIT#2),
  JWT-HS256-pin, /metrics-token-gate, animal-403→404, media-host-allowlist, transfer/claim enum-oracle
  (rate-limited), claim-code atomic single-use.
- **CONFIRMED still-open (4):** contact-reveal Sybil (per-account key), listing-flood quota,
  refresh rotate-TOCTOU, AGENT-not-least-privilege (FC-2 / `[NS]`).
- **SEV-CHG (1 ↑):** contact-reveal Sybil likelihood LOW→MEDIUM — contact_phone writer now live.
- **NEW (5):** consent tie-break fail-open, consent-reveal TOCTOU, Idempotency-Key unbounded,
  metrics XFF/trust-proxy residual, media http/redirect-SSRF residual.
- **REFUTED (0).**

## Gate stance
The two AUDIT3 pre-outward BLOCKERS (dev-token fail-open, /metrics exposure) are **CLOSED** — the core
auth/refresh/media/metrics surface is now **GO-with-controls** for an internet-reachable deploy, IF:
(a) prod sets `NODE_ENV=production`, `METRICS_TOKEN`, and never `ENABLE_DEV_TOKEN=true` — verify in
deploy config; (b) `trust proxy` is not enabled for the metrics path. **Before contacts populate at
scale:** land per-seller/per-listing reveal caps + listing-creation quota (the two live abuse vectors).
**Before ANY agent operator-power:** the AGENT-scope least-privilege seam (`[NS]` BLOCKED) — route to
architect (ADR). The rotate-TOCTOU + consent tie-break are low-risk fail-safe fixes; fold into the next
gated slice. The five NEW findings are MINOR/INFO defense-in-depth, none block the current backend gate.

*Scope note:* `trust proxy` config, edge header caps, deploy env values, and any future server-side
media fetcher are `требует ручной проверки` (devops) — I audited backend code + DTOs + guards + env +
schema only. No product src modified; this file is my sole output.
