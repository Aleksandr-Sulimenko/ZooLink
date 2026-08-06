/**
 * schema-invariants.e2e-spec.ts — AUDIT5 commit-2 Р10-B: the Jest mirror of scripts/check-schema-
 * invariants.sh. Two assertions, the same registry (scripts/schema-invariants.txt) as the CI job:
 *
 *   (1) META-GATE (Q8): every chk_/uq_/trg_ DEFINED in database_schema.sql is listed in the registry
 *       (canon ⊆ registry) — a hand-maintained list cannot silently lose an item.
 *   (2) EXISTENCE-ASSERT (Р9-B/Р10-B): every registered invariant EXISTS in the applied schema
 *       (pg_constraint / pg_class-index / pg_trigger / pg_proc). Runs against a THROWAWAY DB built
 *       from database_schema.sql (Р10-A helper) so a canon-only removal reflects here → RED.
 *
 * This is the authoritative, name-based gate — independent of the fragile per-invariant negative
 * INSERT tests (which can silently measure a stale dev DB). See AUDIT5/PACK-PROPOSAL.md §Р-9/§Р-10.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { provisionCanonicalDatabase, type CanonicalDb } from './support/canonical-db';

const REPO_ROOT = join(__dirname, '..', '..');
const CANON = readFileSync(join(REPO_ROOT, 'database_schema.sql'), 'utf8');
const REGISTRY_RAW = readFileSync(join(REPO_ROOT, 'scripts', 'schema-invariants.txt'), 'utf8');

/** Registered names (strip '#' comments + blanks). */
const registry = new Set(
  REGISTRY_RAW.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#')),
);

/** DEFINED chk_/uq_/trg_ names in canon (defining occurrences only — NOT comment mentions). */
function canonDefinedNames(): Set<string> {
  const out = new Set<string>();
  const patterns: RegExp[] = [
    /\bCONSTRAINT\s+((?:chk_|uq_)[a-z0-9_]+)/gi,
    /\bADD\s+CONSTRAINT\s+((?:chk_|uq_)[a-z0-9_]+)/gi,
    /\bCREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(uq_[a-z0-9_]+)/gi,
    /\bCREATE\s+TRIGGER\s+(trg_[a-z0-9_]+)/gi,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(trg_[a-z0-9_]+)/gi,
  ];
  for (const re of patterns) {
    for (const m of CANON.matchAll(re)) out.add(m[1].toLowerCase());
  }
  return out;
}

describe('AUDIT5 schema-invariant gate (Р9-B/Р10-B/Q8)', () => {
  let canon: CanonicalDb;
  let prisma: PrismaClient;
  const ORIGINAL = process.env.DATABASE_URL;

  beforeAll(async () => {
    canon = provisionCanonicalDatabase();
    prisma = new PrismaClient({ datasources: { db: { url: canon.url } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (ORIGINAL !== undefined) process.env.DATABASE_URL = ORIGINAL;
    canon?.teardown();
  });

  it('META-GATE (Q8): every chk_/uq_/trg_ defined in canon is registered', () => {
    const unregistered = [...canonDefinedNames()].filter((n) => !registry.has(n)).sort();
    expect(unregistered).toEqual([]); // any name here → add it to scripts/schema-invariants.txt
  });

  it('EXISTENCE-ASSERT (Р9-B/Р10-B): every registered invariant exists in the applied schema', async () => {
    const names = [...registry]; // bound as a single text[] parameter (parameterized, ADR-0007)
    const rows = await prisma.$queryRaw<{ n: string }[]>`
      SELECT n FROM unnest(${names}::text[]) AS n
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = n
        UNION ALL SELECT 1 FROM pg_class   WHERE relkind = 'i' AND relname = n
        UNION ALL SELECT 1 FROM pg_trigger WHERE tgname  = n
        UNION ALL SELECT 1 FROM pg_proc    WHERE proname = n)
      ORDER BY n`;
    const missing = rows.map((r) => r.n);
    expect(missing).toEqual([]); // any name here → a registered invariant is absent from canon-built schema
  });
});
