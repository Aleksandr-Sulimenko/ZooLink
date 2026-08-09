# ADR-0043: Error response body — what the normalizer carries and what it strips

**Status**: Accepted
**Date**: 2026-08-08 (Proposed → **Accepted** 2026-08-09: пять мест канона уже
ссылаются на этот ADR как на НОРМУ внешнего контракта — `API_CONVENTIONS.md:72`, `nfr/availability.md:16`,
`specs/11-organization-domain.md:503` и оба RU-зеркала. Документ, на который ссылаются как на норму, не может
оставаться «предложением»; радиус подтверждён обходом AST: из 218 сайтов `new *Exception({…})` вне allow-list
только 8, все в spec-файлах, продовых ноль.)

> Authored by the agent-os architect (holder) because two packs waited on it: the health-503 diagnostics
> mini-pack and the `problem.filter` seam. Implemented by the zoolink track. RU mirror:
> `docsRU/04-decisions/0043-error-response-body-allow-list.md`.
>
> **AMENDED 2026-08-08 before landing, by the holder's verdict — see rule 3.** The first draft said health
> should report failing checks as an array of NAMES. That was measured against the published contracts and
> found wrong: `errors: { type: array, items: { type: object } }` appears VERBATIM in 12 EN api-contract
> files and 12 RU mirrors, with no exception. An array of names would have violated 24 published contracts
> at once, and it would have given ONE member two shapes depending on the error class — a consumer would
> have to tell them apart by context that nobody sends it. The contract was fixed in this document first
> and only then in code (directive №3). Recorded here so nobody restores "names" later for being prettier.

## Context and Problem Statement

Two findings of 2026-08-08 have one root:

1. **`/health/ready` returns 503 with no diagnostics.** The status is honest, but the operator — human
   **or AI (ADR-0006)** — cannot tell from the body *which* dependency is down. The indicator's own
   `info`/`error`/`details` are dropped by the global RFC7807 filter.
2. **The seam itself loses payload.** `applyHttpExceptionBody` copies exactly `message`, `code`, `errors`
   from an `HttpException` body — **everything else disappears silently**. Terminus is merely the first
   caught instance; the defect belongs to the seam, not to health.

Both are the same class: **a normalizer that silently drops payload it was never taught about.** Silence
here is worse than an error, because the caller sees a well-formed reply and concludes there was nothing
more to say.

**And a third finding constrains the fix**: `/health/*` is **public** (`@Public()` on the controller).
Terminus `details`/`error` carry indicator messages — for redis that is the `host:port` from the driver,
for prisma a connection fragment. Returning them to an unauthenticated internet **exactly while the system
is degraded** would be a fresh topology leak. The naive fix is a security regression.

## Decision Drivers

- **A dropped field must be a decision, not an accident.** Today the seam's behaviour for an unknown
  payload is "whatever happened to be written".
- **Public surfaces reveal nothing about internals**; diagnostics belong in the log, which is already
  redacted (pino).
- **No second door**: a richer public surface, if ever needed, goes behind the token gate that already
  exists (`metrics.guard`), never a new one.
- **One member, one shape.** A member whose shape depends on the error class forces every consumer to
  disambiguate by context it was never given.
- **The fix is tested against its own class**, not against the single health case.
- **Weaker-model safety (dir. №10)**: the rule must be readable in the code that enforces it, so the next
  reader cannot restore the old behaviour "for convenience".

## Considered Options

### Option 1: Pass through everything the exception carries — REJECTED
Simplest and wrong: it publishes indicator internals on a public route, and makes every future exception
payload part of the public contract by accident.

### Option 2: Keep the current implicit allow-list (`message`/`code`/`errors`) — REJECTED
This is today's behaviour. It "works" and is precisely the defect: the set is implicit, undocumented, and
silence is indistinguishable from "nothing to add".

### Option 3: Explicit, documented allow-list + names-only diagnostics — CHOSEN, then AMENDED
The seam declares, in one place, what it carries and what it strips; health reports its failing checks
through the existing `errors` member. **Amendment:** those entries are OBJECTS, not bare names (rule 3).

## Decision

**Option 3, as amended**, under the rules below.

### Rules (normative)

1. **The allow-list is explicit and lives next to the code that applies it.** Fields carried from an
   `HttpException` payload: `message` → `detail`, `code`, `errors`. Anything else is **stripped
   deliberately**, and the docstring says so in one sentence.
2. **Unknown payload is not silently lost.** When a payload carries keys outside the list, the filter
   emits a **structured log line** (level `warn`, no values — key names only) naming the dropped keys and
   the route. The response stays clean; the loss becomes visible to us.
   - **Deduplication key = route pattern + the sorted key set**, not the key set alone: the same unknown
     payload arriving on different routes must not collapse into one line, or the address is lost.
   - **Framework envelope is excluded by EXACT NAME**: `statusCode` and `error` are Nest's own envelope
     (`new NotFoundException('gone')` always produces them), not our payload. Without this exclusion the
     warning would fire on nearly every error and the rule would die of noise within a day — the usual
     death of such a list. The exclusion is by exact names, never by mask or by "Nest-ish fields", and
     **adding a name to it is a separate decision, not an append-by-analogy.**
3. **`/health/*` reports failing checks as OBJECTS in `errors`, in the published shape** — e.g.
   `errors: [{ "field": "redis", "message": "down" }]`. **No** indicator messages, hosts, ports, stack
   traces or driver text — those go to the log only.
   *Why objects and not names (the amendment):* `errors: { type: array, items: { type: object } }` is
   published verbatim in 12 EN contracts + 12 RU mirrors, and `ALREADY_CLAIMED` already puts an object
   there correctly. Bare names would have broken 24 contracts and split one member into two shapes.
   *On the `field` key:* here it names **the thing the entry is about** — a readiness CHECK, not a request
   field. The published shape is kept as-is (24 places), but the mismatch between the key's name and its
   meaning is written down HERE deliberately: an unnamed mismatch survives only until the first reader who
   takes it literally and concludes that a 503 body carries a request field. Read `field` as "the named
   thing this entry is about".
4. **No new public surface for detail.** If richer diagnostics are ever required publicly, they go behind
   the existing ops-token gate; a second gate is not created. Alerting is done on a **metric**
   (`zoolink_readiness_check_down{check="…"}`), never by parsing the response body — parsing the body
   would make the body an ops contract right after we narrowed it for non-leakage.
5. **`detail` on 503 is a STATIC constant, never a template.** It carries meaning for a human; the machine
   uses `errors`. It must contain no interpolation, because this is exactly the place where someone will
   later paste `"…unavailable: redis at 10.0.0.5:6399"` for easier debugging. Enforced by an axis: the 503
   body contains no port digits and no host name — so the temptation meets a red suite, not someone's
   conscientiousness.
6. **The rules are enforced by tests, not by discipline**: a payload containing a secret-looking string
   must never appear in the response body (negative axis).

### Verification (measured, not asserted)

- **Class axis, not case axis**: an `HttpException` whose payload uses keys outside the list → response
  deterministic (stripped) **and** a warn line names the dropped keys. Red-before on today's
  implementation (no line at all).
- **Public leak axis (negative)**: a payload carrying a `host:port`-shaped string → that string is absent
  from the body, present in the log.
- **Static-detail axis**: the 503 body matches no port/host pattern (rule 5).
- **Health axis**: with redis down, `/health/ready` → 503 with `errors: [{field:"redis",message:"down"}]`,
  and the body contains **no** driver message; with everything up → 200 unchanged.
- **No-regression axis (pair)**: existing consumers of `message`/`code`/`errors` — including the moderation
  `ALREADY_CLAIMED` holder context — behave byte-identically.
- **Radius is measured, not assumed**: an AST sweep of every `new *Exception({…})` in `backend/src` shows
  no production site carrying a member outside the known set ⇒ `/v1` error bodies do not change at all,
  and the new warn line is silent today: it is an alarm for the future.
- **Rollback is rehearsed BOTH WAYS before the work window**, not after.
- Every axis runs on the state of the tree it is committed with (separability, as proven 2026-08-08).

## Consequences

**Positive**: the seam's behaviour becomes a stated contract; the operator learns *which* dependency is
down without the system telling the internet where it lives; unknown payloads stop vanishing without
trace; `errors` keeps ONE shape across the whole API.

**Negative / accepted**: object-shaped health entries are more verbose than names; depth requires the log.
Changing the response shape touches **every** API reply ⇒ the pack ships with a work-window announcement
and a rollback (ADR-0019 of the agent-os canon), rehearsed before the window.

**Rollback order** (ADR-0042 rule 7, direction-of-failure): the pack is code only — no migration, schema,
seed or env — so nothing in the DB is undone either way, and a partially reverted tree cannot serve a
broken contract to anyone (the direct change can only ADD `detail`/`errors`/a log line, and no consumer of
those exists yet). The rule that WILL matter later is written into the rollback script: once a reader of
`errors[].field` exists (an alert rule, an ops-agent probe, a dashboard), that reader is removed FIRST and
the code second — the reverse order leaves a watcher staring at a member that vanished, i.e. a mute blind
spot, which is the very class this ADR closes.

## Related

ADR-0006 (agent as operator — the AI operator hits the same wall as a human) · ADR-0019 (work windows on
shared rails) · ADR-0042 rule 7 (rollback order by direction of failure) · `API_CONVENTIONS.md` §4
(the `Problem` envelope and the `errors` member) · the migration/gate work of 2026-08-08 · agent-os memory:
`memory/shared/lesson-fix-two-paths-of-three.md` (one truth may have several homes — check the mirrors),
`memory/shared/lesson-optional-observer-eternal-silence.md` (a wiring error that becomes silence),
`memory/reviewer-qa/lesson-check-the-remedy-a-gate-advises.md` (a gate's advice has consequences).
