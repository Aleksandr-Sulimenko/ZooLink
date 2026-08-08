/**
 * One-shot DB provisioner (compose `provision` service / `npm run db:provision`).
 *
 * Brings a database — EMPTY **or ALREADY POPULATED AND STALE** — to the current canonical shape with
 * ZERO manual steps, mirroring the proven CI sequence:
 *   1. If the DB is empty (no `public.users`), apply the canonical `database_schema.sql`
 *      (35 tables + reference seed). That file is a fresh-bootstrap file and is **NOT**
 *      idempotent (bare `CREATE TABLE`), so it is applied ONLY when the DB is empty (guard) —
 *      re-running `up` on a provisioned volume skips it.
 *   2. ALWAYS replay every `migrations/*.sql` in order. This is what makes an AGEING VOLUME
 *      converge (see WHY below). Every migration is idempotent by construction (IF [NOT] EXISTS /
 *      ON CONFLICT / guarded DO blocks) and CI proves it: the `migration-drift` job replays the
 *      whole set TWICE on one database as a HARD gate.
 *   3. Run the idempotent seed (`npm run seed`) — same runner CI uses, so the seed-file list
 *      stays single-sourced in seed.ts. Safe to repeat (every statement is ON CONFLICT DO NOTHING).
 *
 * ── WHY step 2 exists (the incident it is the fix for) ────────────────────────────────────────────
 * Before it, provisioning applied the canon ONLY to an empty DB and replayed NO migrations, so a
 * long-lived compose volume silently froze at the shape it was created with while the code moved on.
 * Observed live 2026-08-07 on a five-week-old volume: `POST /api/v1/auth/register/phone` returned
 * 500 `users.email_bidx does not exist` (column added by migration 0028), while `/health/*` and
 * `GET /listings` stayed green because they never touch the new columns — a drift that is INVISIBLE
 * to health checks and only surfaces on the write path a user hits. Replaying the migrations closes
 * it: the volume can no longer drift silently, because every `up` re-converges it.
 *
 * WHY replay rather than a boot-time "schema == canon or refuse to start" gate: a gate DETECTS but
 * does not HEAL — it converts a 500 into a hard boot failure and still needs a human/agent to repair
 * the volume by hand, which is the opposite of the ADR-0006 goal of operations an agent can drive.
 * Replay is also the SAME machinery CI already gates end-to-end: `migration-drift` proves
 * (canon) ≡ (canon + every migration) and proves the replay is idempotent, so the healing path is
 * under test on every commit rather than being a second, untested schema-comparison mechanism.
 *
 * WHY replay unconditionally (also on a just-created DB) rather than only on a pre-existing one:
 * ONE code path is provable and testable; a branch would leave the migration path unexercised in the
 * common fresh case and let the two paths rot apart. On a fresh canon-built DB the replay is a
 * proven no-op — that is exactly what the `migration-drift` DDL diff asserts.
 *
 * Idempotent overall: a second run on a provisioned volume is a no-op (schema skipped, migrations =
 * idempotent DDL, seed = upsert). Applied via node-pg (not psql) so no extra binary is needed;
 * neither database_schema.sql nor the migrations use psql meta-commands. Designed to run from the
 * Dockerfile `build` stage (has ts-node + pg + source), with database_schema.sql and migrations/
 * bind-mounted in (they live outside the backend context).
 *
 * Acceptance is automated, both directions: scripts/check-provision-heals-stale-db.sh (CI job
 * `provision-heals-stale-db`) simulates a lagging volume, proves this provisioner heals it, and
 * proves the pre-fix behaviour fails on exactly the missing column (SQLSTATE 42703).
 *
 * ── KNOWN RESIDUE of replaying the whole set (audited 2026-08-08, recorded not dissolved) ─────────
 * Every data-touching statement in migrations/*.sql was read for re-run safety on a POPULATED DB.
 * All backfills are guarded (0018 and 0035 by column-existence + "still at the default", 0032/0033 by
 * `WHERE … IS NULL`, 0029's dedup DELETE by the UNIQUE index it creates) — EXCEPT one:
 *   migrations/20260617_0007_species_market.sql — `UPDATE species SET market='livestock' WHERE code IN
 *   (…9 codes…)` is UNCONDITIONAL. Today 3 of those codes exist (cattle, sheep, horse) and are already
 *   'livestock', so the replay is a no-op. But the admin reference-data API CAN change a species'
 *   market, so if an operator ever flips one of those codes to 'pet', the next provision run would
 *   silently revert it. NOT fixed here: ADR-0007 forbids editing an applied migration. The correct fix
 *   is a NEW migration that supersedes the hard-coded assignment (or moving species.market entirely
 *   into the canon's seed + ON CONFLICT DO NOTHING) — owed, with this address.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

// Migrations directory — same default resolution as seed.ts (in-container WORKDIR /app → /migrations,
// bind-mounted by the compose `provision` service; on the host `cd backend` → ../migrations).
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? resolve(__dirname, '../../migrations');

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

    // ── Step 2: converge an AGEING volume (see the WHY block at the top of this file) ─────────────
    // Ordering is byte-lexicographic on the file name, IDENTICAL to the `for f in migrations/*.sql`
    // glob the CI migration-drift job replays — the filenames are `YYYYMMDD_NNNN_*.sql` with a
    // zero-padded number, so lexicographic == chronological == numeric.
    if (!existsSync(MIGRATIONS_DIR)) {
      throw new Error(
        `migrations directory not found: ${MIGRATIONS_DIR} — provisioning would leave an existing ` +
          `volume STALE (the exact silent-drift failure this step exists to prevent). In compose ` +
          `check the \`./migrations:/migrations:ro\` bind mount on the \`provision\` service.`,
      );
    }
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    if (migrations.length === 0) {
      throw new Error(
        `no *.sql files in ${MIGRATIONS_DIR} — refusing to report success: an existing volume would ` +
          `stay STALE. A broken/empty bind mount must be LOUD, not a silent no-op.`,
      );
    }

    // The claim "lexicographic == numeric" above is an INVARIANT OF THE FILENAMES, not a law. It breaks
    // silently the first time a file lands with an earlier date and a higher number (e.g.
    // 20260801_0042_* after 20260805_0041_*), which would reorder the replay without any error. Assert
    // it instead of trusting the comment.
    let prev = 0;
    for (const file of migrations) {
      const m = /_(\d{4})_/.exec(file);
      if (!m) throw new Error(`migration filename has no 4-digit sequence number: ${file}`);
      const n = Number(m[1]);
      if (n <= prev) {
        throw new Error(
          `migration ordering is not monotonic: ${file} (#${n}) sorts after #${prev}. Filename order ` +
            `must equal numeric order — rename so the date prefix ascends with the number.`,
        );
      }
      prev = n;
    }

    // The replay runs on ONE dedicated connection, not via pool.query: `SET lock_timeout` and
    // pg_advisory_lock are SESSION-scoped, so on a pool they could land on a different backend than the
    // migrations they are meant to protect (silently no-op guards).
    const client = await pool.connect();
    try {
      // Fail FAST instead of queueing. Several migrations do `DROP CONSTRAINT IF EXISTS x; ADD
      // CONSTRAINT x CHECK(…)`, which takes ACCESS EXCLUSIVE and re-validates the whole table (no
      // migration uses NOT VALID). On a SERVING database — and `docker compose up -d` on a live stack
      // DOES re-run this provisioner — an ACCESS EXCLUSIVE *waiter* queues AHEAD of every subsequent
      // reader, so one long read on `listings` would turn provisioning into a full read stall on that
      // table. With a lock_timeout the provisioner dies loudly in seconds and `api`/`worker` never
      // start (they gate on it) — a far better failure than a silent stall. Raise both for a planned
      // maintenance window via PROVISION_LOCK_TIMEOUT / PROVISION_STATEMENT_TIMEOUT.
      await client.query(`SET lock_timeout = '${process.env.PROVISION_LOCK_TIMEOUT ?? '5s'}'`);
      await client.query(
        `SET statement_timeout = '${process.env.PROVISION_STATEMENT_TIMEOUT ?? '300s'}'`,
      );
      // Advisory lock: two provisioners (e.g. a stray `compose run provision` during an `up`) must not
      // interleave DDL. Stable arbitrary key; released when this session ends.
      const { rows: lk } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(4021001) AS locked',
      );
      if (!lk[0]?.locked) {
        throw new Error(
          'another provisioner holds the advisory lock (4021001) — refusing to replay migrations ' +
            'concurrently. Wait for the other run to finish, then retry.',
        );
      }

      console.log(`Replaying ${migrations.length} idempotent migrations from ${MIGRATIONS_DIR} …`);
      for (const file of migrations) {
        try {
          await client.query(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `migration ${file} failed: ${msg}` +
              (/lock timeout|canceling statement/i.test(msg)
                ? ' — this migration needs ACCESS EXCLUSIVE on a table that is being read right now. ' +
                  'Retry when quiet, or raise PROVISION_LOCK_TIMEOUT for a maintenance window.'
                : ''),
          );
        }
      }
      console.log(`✓ migrations replayed (${migrations[0]} … ${migrations[migrations.length - 1]})`);
    } finally {
      client.release();
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
