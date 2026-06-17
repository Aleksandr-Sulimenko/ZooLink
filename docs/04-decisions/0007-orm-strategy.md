# ADR-0007: ORM strategy — Prisma as primary with a typed raw-SQL escape hatch

**Status**: Accepted
**Date**: 2026-06-17

## Context and Problem Statement

[ADR-0001](0001-tech-stack.md) selected **Prisma** as the ORM. The backend technology audit
(`BACKEND_TECH_AUDIT.md`, Sub-agent 2 — Senior DBA) confirmed Prisma is excellent for typical CRUD and
type-safety, but flagged two structural weaknesses against the ZooLink schema:

1. **Geospatial types.** Prisma does not natively model `GEOGRAPHY(POINT,4326)` (PostGIS). Even the MVP
   `lat`/`lng` Haversine search benefits from hand-written SQL for radius queries.
2. **Complex JSONB.** The schema is JSONB-heavy (localization, `health_records`, `reproductive_data`,
   `metadata`, `filters`). Deep JSONB filtering/aggregation is awkward and sometimes impossible in Prisma's
   query API.

We must resolve this **without** re-opening the Accepted ADR-0001 (no full ORM swap) and without leaving
developers to improvise per-feature.

## Decision Drivers

- **Continuity**: ADR-0001 is Accepted; minimize disruption and rework.
- **Query power**: geo + complex JSONB must be expressible and performant.
- **Type safety**: keep compile-time guarantees end-to-end where possible.
- **SQL-injection safety**: any raw SQL must be parameterized (security NFR).
- **Talent**: keep the stack learnable for the RF talent pool.

## Considered Options

### Option 1: Prisma + Kysely / parameterized raw SQL (escape hatch)
Keep Prisma as the primary ORM for schema, migrations, and the bulk of CRUD. Use **Kysely** (a typed SQL
query builder) or Prisma `$queryRaw` (parameterized) for geo and complex JSONB.

Pros:
- Zero rewrite of the ADR-0001 decision; Prisma migrations remain source of DDL alongside `database_schema.sql`.
- Geo/JSONB get full SQL power; Kysely preserves type safety.
- Clear, documented boundary for when to drop to SQL.

Cons:
- Two query mechanisms in the codebase (mitigated by an explicit usage rule).
- One extra dependency (Kysely).

### Option 2: Full switch to TypeORM
Pros:
- Single tool; QueryBuilder handles raw/geo well; wider RF familiarity.
Cons:
- Contradicts Accepted ADR-0001 (requires superseding); migration rewrite; TypeORM has its own sharp edges.

### Option 3: Plain Prisma only
Pros:
- Simplest dependency set.
Cons:
- Geo and complex JSONB forced through ad-hoc `$queryRaw` with no shared, typed pattern → inconsistency and
  latent SQL-injection risk if done carelessly.

## Decision

Adopt **Option 1**. **Prisma remains the primary ORM** (schema, migrations, CRUD). For geospatial queries
(MVP Haversine on `lat`/`lng`; future PostGIS) and complex JSONB, use **Kysely** (preferred, typed) or
**parameterized** Prisma `$queryRaw`. Raw string interpolation of user input is prohibited.

## Consequences

### Positive
- ADR-0001 stands; no costly ORM migration.
- Geo and JSONB are first-class via SQL, with type safety retained through Kysely.
- A single, documented rule prevents per-developer improvisation.

### Negative
- Developers must learn when to use Prisma vs Kysely (documented below).
- Two libraries touching the DB; schema drift risk between them (mitigated: `database_schema.sql` is the
  source of truth; Prisma schema and Kysely types are generated/checked against it).

### Neutral
- `database_schema.sql` remains the canonical schema; Prisma `schema.prisma` mirrors it.

## Implementation Notes

- **Usage rule:** Prisma for entity CRUD and simple relations. Kysely/`$queryRaw` for: radius/geo search,
  recursive pedigree (`WITH RECURSIVE` over `mother_id`/`father_id`), JSONB containment/aggregation, and any
  query Prisma cannot express efficiently.
- **Geo:** model `location_point` as `Unsupported("geography")` in Prisma; never queried via Prisma directly.
- **Safety:** all raw SQL parameterized; add an ESLint/CI check against raw string concatenation in queries.
- **Connection pooling:** Prisma's pool in MVP; PgBouncer (transaction mode) in front of PostgreSQL when
  connection counts grow (see `specs/performance_specification.md`).

## Related Decisions

- [ADR-0001](0001-tech-stack.md): selected Prisma; this ADR refines, not supersedes it.
- [ADR-0009](0009-mvp-vs-target-architecture.md): MVP scope (monolith) within which this ORM rule applies.

## References

- `BACKEND_TECH_AUDIT.md` — Sub-agent 2 (Senior DBA) findings.
- `docs/03-architecture/data-model.md`, `database_schema.sql`, `specs/07-geo-search-service.md`.
