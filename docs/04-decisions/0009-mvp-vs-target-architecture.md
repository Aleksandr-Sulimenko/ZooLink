# ADR-0009: MVP architecture is a modular monolith — defer microservices/K8s to Фаза 2+

**Status**: Accepted
**Date**: 2026-06-17

## Context and Problem Statement

The audit (`BACKEND_TECH_AUDIT.md`, главная находка) found that the documentation describes **two
contradictory backends**:

- [ADR-0001](0001-tech-stack.md) (canon): a **modular monolith** (NestJS), Docker Compose for MVP, Kubernetes
  "considered for Фаза 2+", no message broker.
- The `component-diagram.md` and `deployment-diagram.md`: **microservices**, gRPC, a standalone Event Bus,
  SSR Web Gateway, read replicas, a service mesh, and a full multi-zone **Kubernetes** cluster.

For the documented MVP load (`specs/performance_specification.md`: 500 concurrent users, 50 RPS average,
200 RPS peak), the heavyweight architecture is **overengineering** that would cost months and recurring ops
burden. Without an explicit boundary, the team may build the diagrams instead of the ADR.

## Decision Drivers

- **Load reality**: 50–200 RPS is comfortably served by a monolith on 2–3 replicas behind a proxy.
- **Time-to-validation**: MVP exists to validate business hypotheses, not to pre-scale.
- **Operability**: Docker Compose is operable by a small team; K8s + service mesh is not, for MVP.
- **No premature distribution**: distributed systems add failure modes (gRPC, eventual consistency) with no
  current payoff.

## Considered Options

### Option 1: Modular monolith for MVP; microservices/K8s as explicit Target State (Фаза 2+)
Pros:
- Matches ADR-0001 and the actual load; fastest to ship; cheapest to operate.
- Module boundaries (DDD bounded contexts) preserve a clean extraction path later.
Cons:
- Diagrams must be re-labeled as Target State (done in this remediation).

### Option 2: Build microservices/K8s now (as diagrams imply)
Pros:
- "Future-proof" topology from day one.
Cons:
- Massive overhead for 50 RPS; slows validation; high ops cost; contradicts ADR-0001.

## Decision

**The MVP (Фаза 1) is a modular monolith.** Adopt the following binding scope:

**MVP (Фаза 1) — IN:**
- Single NestJS deployment with internal modules = bounded contexts (`identity`, `animal`,
  `pet-marketplace`, `livestock-marketplace`, `admin`, `moderation`, …). Inter-module calls = in-process DI.
- **Docker Compose** on 1–2 VMs: `api` (1–N replicas), `postgres`, `redis`, `minio`, a background `worker`.
- A **reverse proxy** (Nginx/Caddy/Traefik) for TLS + static SPA + CDN origin.
- **Events via the `outbox_events` table** drained by the background worker (polling / `pg_notify`) — **no
  standalone broker**.
- Stateless API (JWT) so replicas scale horizontally; Redis for shared state and rate limiting.
- **Network isolation via Docker networks**: only the reverse proxy is public; DB/Redis/MinIO never exposed.

**Фаза 2+ — DEFERRED (do NOT build in MVP):**
- Microservices decomposition, **gRPC** inter-service calls, **service mesh** (Istio/Linkerd).
- Standalone **Event Bus** / message broker (RabbitMQ/Kafka) — adopt only when outbox-draining is insufficient.
- **Kubernetes**, HPA/VPA/Cluster Autoscaler, multi-zone DR.
- Read replicas, SSR Web Gateway, Elasticsearch, PostGIS.

## Consequences

### Positive
- Single, coherent target for the team; no "which diagram is real?" ambiguity.
- Lowest cost/fastest path to a production MVP that meets the perf NFRs.
- Clean extraction seams retained via DDD modules.

### Negative
- A future migration step to microservices/K8s when scale demands it (planned, not accidental).

### Neutral
- The Target diagrams remain valuable as the Фаза 2+ blueprint; they are now labeled accordingly.

## Implementation Notes

- `component-diagram.md` and `deployment-diagram.md` carry an **MVP vs Target State** banner pointing here.
- The background `worker` owns: outbox draining, scheduled jobs (cron), async notifications, cleanup of
  unfinished uploads.
- Define the **outbox relay** contract in the data-model (table exists: `outbox_events`).
- Revisit this ADR when sustained RPS, team size, or domain isolation needs cross the thresholds in
  `specs/performance_specification.md` (Фаза 2 "Growth").

## Related Decisions

- [ADR-0001](0001-tech-stack.md): chose the monolith + Compose for MVP (this ADR makes the boundary binding).
- [ADR-0007](0007-orm-strategy.md), [ADR-0008](0008-rf-provider-matrix.md): apply within this MVP scope.

## References

- `BACKEND_TECH_AUDIT.md` — Sub-agent 1 (System Architect) & главная находка.
- `specs/performance_specification.md` (load targets), `docs/03-architecture/*`.
