/**
 * One-shot DB provisioner (compose `provision` service / `npm run db:provision`).
 *
 * Brings an EMPTY database to the full canonical shape with ZERO manual steps — mirroring the
 * proven CI sequence (apply database_schema.sql → seed):
 *   1. If the DB is empty (no `public.users`), apply the canonical `database_schema.sql`
 *      (35 tables + reference seed). That file is a fresh-bootstrap file and is **NOT**
 *      idempotent (bare `CREATE TABLE`), so it is applied ONLY when the DB is empty (guard) —
 *      re-running `up` on a provisioned volume skips it.
 *   2. Run the idempotent seed (`npm run seed`) — same runner CI uses, so the seed-file list
 *      stays single-sourced in seed.ts. Safe to repeat (every statement is ON CONFLICT DO NOTHING).
 *
 * Idempotent overall: a second run on a provisioned volume is a no-op (schema skipped, seed = upsert).
 * Applied via node-pg (not psql) so no extra binary is needed; database_schema.sql uses no psql
 * meta-commands. Designed to run from the Dockerfile `build` stage (has ts-node + pg + source),
 * with database_schema.sql and migrations/ bind-mounted in (they live outside the backend context).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

/** Minimal .env loader (no dep): fills only keys not already in process.env. (matches seed.ts) */
function loadEnv(...files: string[]): void {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

loadEnv(resolve(__dirname, '../.env'), resolve(__dirname, '../../.env'));

// Canonical schema location. Default resolves to the repo root both in-container (WORKDIR /app →
// /database_schema.sql, bind-mounted) and on the host (cd backend → ../database_schema.sql).
const SCHEMA_FILE =
  process.env.SCHEMA_FILE ?? resolve(__dirname, '../../database_schema.sql');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.users')::text AS reg`,
    );
    const schemaPresent = rows[0]?.reg !== null;

    if (schemaPresent) {
      console.log('✓ schema already present (public.users exists) — skipping schema apply');
    } else {
      if (!existsSync(SCHEMA_FILE)) {
        throw new Error(`canonical schema file not found: ${SCHEMA_FILE}`);
      }
      console.log(`Applying canonical schema from ${SCHEMA_FILE} …`);
      await pool.query(readFileSync(SCHEMA_FILE, 'utf8'));
      console.log('✓ canonical schema applied');
    }

    const { rows: t } = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    console.log(`  public base tables: ${t[0].count}`);
  } finally {
    await pool.end();
  }

  // Seed (idempotent). Reuse the canonical seed runner so the seed-file list stays single-sourced
  // in seed.ts. SEED_FORCE=true because compose runs NODE_ENV=production but reference/lookup data
  // is non-user data and is intended to be present in every environment (the runner is idempotent).
  console.log('Running idempotent seed (npm run seed) …');
  execSync('npm run seed', {
    stdio: 'inherit',
    env: { ...process.env, SEED_FORCE: 'true' },
  });

  console.log('✓ provisioning complete');
}

main().catch((err) => {
  console.error('Provision failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
