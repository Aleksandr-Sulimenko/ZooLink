/**
 * canonical-db.ts — AUDIT5 commit-2 Р10-A: run a DB-invariant e2e suite against a THROWAWAY database
 * whose schema is built ONLY from the canonical `database_schema.sql`, never the ambient dev DB.
 *
 * WHY: `npm run db:sync` is `prisma db pull` — introspect-only. It never REBUILDS the dev DB, so an
 * object dropped from canon (+ its migration) lingers physically in dev, and a negative-INSERT test
 * that connects to dev keeps passing (reviewer-qa Р-10: 16/16 green while the invariant was deleted
 * from the artifacts). A suite that provisions its own DB from `database_schema.sql` measures the
 * ARTIFACT, so a canon change is reflected and the mutation goes RED.
 *
 * HOW: {@link provisionCanonicalDatabase} `CREATE DATABASE`s a uniquely-named throwaway and applies
 * `database_schema.sql` into it via `psql`, then returns a DATABASE_URL the caller assigns to
 * `process.env.DATABASE_URL` BEFORE compiling AppModule (PrismaClient reads that env at construction).
 *
 * GRACEFUL FALLBACK: creating a database needs the CREATEDB privilege. CI's postgres service role
 * (superuser) has it → the gate is AUTHORITATIVE there. A local dev role that lacks it (our host
 * PG14 `zoolink`) cannot — rather than break `npm run test:e2e`, the helper logs a loud warning and
 * returns the ambient DATABASE_URL unchanged (`provisioned:false`). The suite still runs (no
 * regression, no false SKIP in the count), but only a canon-built run (CI / a superuser DB) is
 * authoritative for RED-under-mutation. The independent `schema-invariants` CI job backstops this.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/** Repo-root canonical schema (…/backend/test/support → …/database_schema.sql). */
const SCHEMA_SQL = join(__dirname, '..', '..', '..', 'database_schema.sql');

export interface CanonicalDb {
  /** DATABASE_URL to point Prisma at (throwaway when provisioned, else the ambient URL). */
  url: string;
  /** True iff a fresh canon-built throwaway DB was created (CI / superuser). */
  provisioned: boolean;
  /** Drop the throwaway DB (no-op on the fallback path). Call in afterAll. */
  teardown: () => void;
}

/** A libpq conninfo URL (no Prisma-only `?schema=` query, which libpq rejects). */
function conninfo(u: URL, dbName: string): string {
  const auth = u.password ? `${u.username}:${u.password}` : u.username;
  return `postgresql://${auth}@${u.host}/${dbName}`;
}

/** Apply a psql `-c`/`-f` action against a conninfo, throwing on any SQL error. */
function psql(conn: string, action: string[]): void {
  execFileSync('psql', [conn, '-v', 'ON_ERROR_STOP=1', '-q', ...action], { stdio: 'pipe' });
}

/**
 * Provision a throwaway canon-built DB, or fall back to the ambient DATABASE_URL when the role
 * cannot CREATE DATABASE. Never throws for a privilege problem — only for a genuinely broken canon
 * apply (which SHOULD fail the suite).
 */
export function provisionCanonicalDatabase(): CanonicalDb {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('canonical-db: DATABASE_URL is not set');
  const u = new URL(base);
  const dbName = `zoolink_inv_${process.pid}_${randomBytes(3).toString('hex')}`;
  const adminConn = conninfo(u, 'postgres'); // maintenance DB for CREATE/DROP DATABASE

  try {
    psql(adminConn, ['-c', `CREATE DATABASE ${dbName}`]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[canonical-db] CREATE DATABASE failed (role lacks CREATEDB?) — falling back to the ambient ` +
        `DATABASE_URL. Invariant coverage is authoritative only on a canon-built DB (CI/superuser). ${msg}`,
    );
    return { url: base, provisioned: false, teardown: () => undefined };
  }

  const childConn = conninfo(u, dbName);
  try {
    psql(childConn, ['-f', SCHEMA_SQL]); // build the schema from the ARTIFACT only
  } catch (err) {
    // A broken canon apply is a real failure — tear down and rethrow so the suite fails loudly.
    try {
      psql(adminConn, ['-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
    } catch {
      /* best-effort */
    }
    throw err;
  }

  // App URL keeps the original query (e.g. ?schema=public) so Prisma resolves the schema correctly.
  const appUrl = new URL(base);
  appUrl.pathname = `/${dbName}`;
  return {
    url: appUrl.toString(),
    provisioned: true,
    teardown: () => {
      try {
        psql(adminConn, ['-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
      } catch {
        /* best-effort — throwaway DBs on ephemeral CI PG are discarded anyway */
      }
    },
  };
}
