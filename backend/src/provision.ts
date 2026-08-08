/**
 * One-shot DB provisioner (compose `provision` service / `npm run db:provision`).
 *
 * GATE-CONTRACT: MIGRATION_REPLAY=UNCONDITIONAL — asserted by scripts/check-dropped-column-reuse.js
 *   (the dropped-name gate). Making this replay conditional invalidates that gate's rules: change both
 *   together, via an ADR. That gate fails LOUD (exit 2) if this marker says anything other than
 *   UNCONDITIONAL, and it also proves the property structurally — so this line is documentation of the
 *   contract, not its only witness.
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
 * ── KNOWN RESIDUE of replaying the whole set (audited 2026-08-08; the 0007 item CLOSED 2026-08-08) ──
 * Every data-touching statement in migrations/*.sql was read for re-run safety on a POPULATED DB.
 * Backfills are guarded, each in its own way — the distinction matters, so state it exactly:
 *   · 0018 — by LEGACY-column existence (`name_ru`, which the same migration then DROPs, so the backfill
 *     can never fire again) AND by "still at the default" (`WHERE name_localized = '{"ru":"","en":""}'`);
 *   · 0035 — by NEW-column NON-existence (a DO block: the backfill fires only on the boot that creates
 *     `content_updated_at`). It carries no "still at the default" test — that clause belongs to 0018.
 *   · 0032/0033 — by `WHERE … IS NULL` over a column that is then `SET NOT NULL`;
 *   · 0029's dedup DELETE — by the UNIQUE index it creates two statements later (see the residue below).
 *
 * FIXED (migrations/20260808_0042_species_market_replay_guard.sql):
 *   migrations/20260617_0007_species_market.sql — `UPDATE species SET market='livestock' WHERE code IN
 *   (…9 codes…)` is UNCONDITIONAL, and this step used to run it on every `up`. Two effects, BOTH real:
 *     (1) it is a no-op BY VALUE but NOT BY ROW — measured on a live PG 16: the 3 existing codes
 *         (cattle/sheep/horse) were physically rewritten on every run (`xmin` advanced, `updated_at`
 *         moved) while breeds/cities/feature_toggles were untouched. Since the reference-data ETag is
 *         derived from `updated_at`, every `compose up` rotated those ETags and could 412 an admin's or
 *         an AI operator's conditional request (ADR-0006) — the very class migration 0035 exists to
 *         prevent for listings (`content_updated_at`), recreated here by the provisioner;
 *     (2) the admin reference-data API CAN change a species' market, so an operator flipping one of
 *         those codes to 'pet' had the decision silently reverted on the next run — and `listings.market`
 *         (the derived cache, migration 0033) is recomputed ONLY by the admin PATCH path, so the raw
 *         UPDATE also desynchronised source and cache with no self-healing (the 0033 backfill is
 *         `WHERE market IS NULL` and the column is NOT NULL).
 *   Fix form: ADR-0007 forbids editing an applied migration, so 0007 stays verbatim and its EFFECT is
 *   superseded — migration 0042 installs `trg_species_market_replay_guard` (BEFORE UPDATE OF market ON
 *   species) which tells the raw replay from the deliberate admin write (transaction-local GUC
 *   `app.reference_data_admin`, the `app.ownership_transfer` idiom). Suppressions are counted below and
 *   printed in this provisioner's own output.
 *
 * STILL OPEN (named, not dissolved — no data loss observed today, but the guards are conditional):
 *   · 0029's dedup `DELETE FROM contact_reveals … WHERE (a.created_at,a.id) > (b.created_at,b.id)` is
 *     re-run-safe ONLY because `uq_contact_reveals_viewer_listing` (created two statements later) makes
 *     duplicates impossible. That guard is ALIENABLE: it lives in a separate, independently droppable
 *     object. Drop or rebuild that index non-uniquely and the next `up` silently deletes rows again.
 *   · DROP COLUMN class (0018: species/breeds/cities.name_ru/name_en; 0041: 4 confirmed_sales + 3 reviews
 *     columns). All `IF EXISTS`, so replay-safe as the schema stands. The trap is forward-looking: if a
 *     LATER migration ever re-introduces a column with one of those names on the same table, every boot
 *     would drop it (0018/0041 run first) and then re-add it empty — the column would still exist at the
 *     end of provisioning, so nothing looks broken, while its CONTENTS are destroyed on every `up`.
 *   · The seed step below re-executes THREE files that this replay loop has ALREADY applied in the same
 *     run (0011, 0010, 0022 — see SEED_FILES in seed.ts), so those three get two shots per provisioning.
 *     Safe today (every statement in them is INSERT … ON CONFLICT DO NOTHING), but it doubles the
 *     exposure of exactly those files: a non-idempotent statement added there fires twice, not once.
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
    // Declared OUTSIDE the try so the `finally` can detach the listener (a `const` inside the try block
    // would not be in scope there).
    let preservedDecisions = 0;
    const onNotice = (msg: { code?: string }): void => {
      if (msg.code === 'ZL042') preservedDecisions += 1;
    };
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

      // ── Count the guard's suppressions and REPORT them in this provisioner's own output ──────────
      // Migration 0042 raises a WARNING with the dedicated SQLSTATE 'ZL042' each time it PRESERVES an
      // operator's `species.market` decision against the unconditional replay of 0007. A trace nobody
      // reads is not a witness (a metric died unnoticed this week), so the count is surfaced here.
      // WHY this mechanism and not the alternatives:
      //   · it adds NO hidden state to the schema — the signal rides the NoticeResponse channel that
      //     already exists on THIS one dedicated replay connection, so it works under the unconditional
      //     replay and cannot pick up another session's events (nor be missed by landing on another pool
      //     member, the same reason the lock/timeout SETs live on this connection);
      //   · a counter table / temp table would BE new state (and a temp table the trigger must find turns
      //     every other writer of species.market into a runtime error when it is absent);
      //   · a before/after data diff CANNOT count this at all: a suppressed write leaves the row exactly
      //     as it was, which is indistinguishable from "nothing was attempted".
      // Matched by SQLSTATE, never by message text (the text is localized; the code is not).
      // (`preservedDecisions` / `onNotice` are declared above the try — see the note there.)
      client.on('notice', onNotice);

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
      // ALWAYS printed, ZERO INCLUDED: a missing line must never be confusable with "the line was
      // forgotten to be printed". A non-zero count is normal and healthy — it means the guard did its
      // job; it is NOT an error. (It also makes the one documented silent case of migration 0042 —
      // shutter lost + same actor + the 0007 fingerprint — visible instead of invisible.)
      console.log(
        `  operator decisions preserved by migration 0042 (species.market): ${preservedDecisions}`,
      );
    } finally {
      client.removeListener('notice', onNotice);
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
