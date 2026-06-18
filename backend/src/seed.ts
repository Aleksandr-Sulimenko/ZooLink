/**
 * Seed runner (Phase 0). Applies the idempotent seed migrations to a dev/test database:
 * reference data (0011) + moderation reasons & notification templates (0010).
 *
 * Seeds are NOT authored here — they live in ../migrations/*.sql (single source of truth);
 * this runner just executes them. Safe to re-run (every statement is ON CONFLICT DO NOTHING).
 *
 * Usage:  npm run seed        (refuses to touch a production DB unless SEED_FORCE=true)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

/** Minimal .env loader (no dep): fills only keys not already in process.env. */
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

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');
const SEED_FILES = [
  '20260618_0011_seed_reference_data.sql',
  '20260617_0010_seed_reasons_templates.sql',
];

const COUNT_TABLES = [
  'supported_languages',
  'species',
  'breeds',
  'cities',
  'feature_toggles',
  'moderation_reasons',
  'notification_templates',
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    throw new Error('Refusing to seed a production database (set SEED_FORCE=true to override)');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const file of SEED_FILES) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      await pool.query(sql);
      console.log(`✓ applied ${file}`);
    }

    console.log('Seed counts:');
    for (const table of COUNT_TABLES) {
      const { rows } = await pool.query<{ count: string }>(`SELECT count(*)::text FROM ${table}`);
      console.log(`  ${table.padEnd(24)} ${rows[0].count}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
