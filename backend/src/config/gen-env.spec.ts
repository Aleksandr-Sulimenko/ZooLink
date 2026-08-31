import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ZodTypeAny } from 'zod';

import { envSchema, validateEnv } from './env.validation';

/**
 * У-2 / У-1 gate for `deploy/gen-env.sh` — the CANONICAL `.env` provisioner (the replacement for the
 * old documented `cp .env.example .env`, which produces an empty METRICS_TOKEN and therefore a
 * production boot that dies in validateEnv).
 *
 * The point of this file is that it does NOT re-describe the env contract. It:
 *   1. EXECUTES the real `deploy/gen-env.sh` in a throwaway directory, and
 *   2. feeds the produced `.env` to the REAL `validateEnv` with NODE_ENV=production,
 *   3. deriving the "required in production" key set PROGRAMMATICALLY from the REAL zod schema.
 * So the generator and the validator are locked to a single source of truth: add a boot-required
 * key to envSchema without teaching the generator about it, and this test goes red.
 *
 * Safety: every run targets an absolute `--env-file` under os.tmpdir(). The repo's real `.env` is
 * never read, written, or even resolved.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GEN_ENV = path.join(REPO_ROOT, 'deploy', 'gen-env.sh');
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');

/** Non-zero exits are expected in some axes, so capture status/stdout instead of throwing. */
function runGenEnv(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync('bash', [GEN_ENV, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

/** Minimal `KEY=VALUE` reader matching docker-compose's `env_file` semantics (no quoting/expansion). */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = line.slice(eq + 1);
  }
  return out;
}

/** envSchema is a ZodEffects (the ADR-0017 residency superRefine) wrapping the ZodObject. */
function unwrapEffects(schema: ZodTypeAny): ZodTypeAny {
  let cur = schema as ZodTypeAny & { _def: { typeName?: string; schema?: ZodTypeAny } };
  while (cur._def?.typeName === 'ZodEffects' && cur._def.schema) {
    cur = cur._def.schema as typeof cur;
  }
  return cur;
}

/**
 * Keys the schema will NOT supply itself: no `.default()` anywhere in the (possibly
 * effects-wrapped) chain. That set is exactly "must come from the environment", and in production
 * it also covers METRICS_TOKEN / AGENT_SERVICE_SIGNING_SECRET, which are `.optional()` in the
 * object but hard-required by the production refines inside validateEnv.
 */
function schemaRequiredKeys(): string[] {
  const shape = (
    unwrapEffects(envSchema) as unknown as {
      shape: Record<string, ZodTypeAny>;
    }
  ).shape;
  return Object.entries(shape)
    .filter(([, field]) => unwrapEffects(field)._def?.typeName !== 'ZodDefault')
    .map(([key]) => key)
    .sort();
}

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zoolink-gen-env-'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function freshDir(name: string): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('deploy/gen-env.sh — the generator is the env contract (У-2)', () => {
  it('is present and executable', () => {
    expect(fs.existsSync(GEN_ENV)).toBe(true);
    expect(fs.statSync(GEN_ENV).mode & 0o111).not.toBe(0);
  });

  it('produces a .env that the REAL validateEnv accepts at NODE_ENV=production', () => {
    const dir = freshDir('accepts');
    const envPath = path.join(dir, '.env');
    const run = runGenEnv(['--env-file', envPath, '--domain', 'localhost']);
    expect(run.status).toBe(0);

    const parsed = parseEnvFile(envPath);
    expect(parsed.NODE_ENV).toBe('production');
    // The assertion that matters: the real boot validator, on the real generated file.
    expect(() => validateEnv(parsed)).not.toThrow();
  });

  it('emits every key the zod schema requires (derived from the schema, not a hand list)', () => {
    const dir = freshDir('required-keys');
    const envPath = path.join(dir, '.env');
    expect(runGenEnv(['--env-file', envPath]).status).toBe(0);
    const parsed = parseEnvFile(envPath);

    const required = schemaRequiredKeys();
    // Guard against the derivation silently collapsing to [] (which would make this test vacuous).
    expect(required.length).toBeGreaterThanOrEqual(10);
    expect(required).toContain('METRICS_TOKEN');

    const missing = required.filter((k) => !parsed[k]);
    expect(missing).toEqual([]);
  });

  it('emits METRICS_TOKEN with >=16 chars (the production /metrics gate — the provisioning hole)', () => {
    const dir = freshDir('metrics-token');
    const envPath = path.join(dir, '.env');
    expect(runGenEnv(['--env-file', envPath]).status).toBe(0);
    expect(parseEnvFile(envPath).METRICS_TOKEN.length).toBeGreaterThanOrEqual(16);
  });

  it('mints secrets long enough for the validator minimums (>=32 for JWT/pepper/PII)', () => {
    const dir = freshDir('secret-lengths');
    const envPath = path.join(dir, '.env');
    expect(runGenEnv(['--env-file', envPath]).status).toBe(0);
    const parsed = parseEnvFile(envPath);
    for (const key of [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PHONE_HASH_PEPPER',
      'PII_DATA_KEY',
      'PII_BLIND_INDEX_KEY',
      'AGENT_SERVICE_SIGNING_SECRET',
    ]) {
      expect(parsed[key].length).toBeGreaterThanOrEqual(32);
    }
  });

  it('supplies every ${VAR} docker-compose.yml interpolates', () => {
    const dir = freshDir('compose-vars');
    const envPath = path.join(dir, '.env');
    expect(runGenEnv(['--env-file', envPath]).status).toBe(0);
    const parsed = parseEnvFile(envPath);

    const compose = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    const interpolated = new Set<string>();
    for (const m of compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) interpolated.add(m[1]);
    expect(interpolated.size).toBeGreaterThan(0);

    const missing = [...interpolated].filter((k) => !parsed[k]).sort();
    expect(missing).toEqual([]);
  });

  it('never prints a value — only key names (У-3)', () => {
    const dir = freshDir('no-value-leak');
    const envPath = path.join(dir, '.env');
    const run = runGenEnv(['--env-file', envPath, '--domain', 'localhost']);
    const output = run.stdout + run.stderr;
    const parsed = parseEnvFile(envPath);
    const secrets = [
      'POSTGRES_PASSWORD',
      'REDIS_PASSWORD',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PHONE_HASH_PEPPER',
      'PII_DATA_KEY',
      'PII_BLIND_INDEX_KEY',
      'AGENT_SERVICE_SIGNING_SECRET',
      'METRICS_TOKEN',
    ];
    for (const key of secrets) {
      expect(parsed[key]).toBeTruthy();
      expect(output).not.toContain(parsed[key]);
    }
  });
});

describe('deploy/gen-env.sh — idempotency and secret freshness (У-1)', () => {
  it('leaves an existing complete .env byte-identical (check mode is read-only) and exits 0', () => {
    const dir = freshDir('rerun');
    const envPath = path.join(dir, '.env');
    expect(runGenEnv(['--env-file', envPath]).status).toBe(0);
    const before = fs.readFileSync(envPath);

    const rerun = runGenEnv(['--env-file', envPath]);
    expect(rerun.status).toBe(0);
    expect(fs.readFileSync(envPath).equals(before)).toBe(true);
  });

  it('mints per run: two fresh .env files are NOT byte-identical', () => {
    const a = path.join(freshDir('fresh-a'), '.env');
    const b = path.join(freshDir('fresh-b'), '.env');
    expect(runGenEnv(['--env-file', a, '--domain', 'localhost']).status).toBe(0);
    expect(runGenEnv(['--env-file', b, '--domain', 'localhost']).status).toBe(0);

    const pa = parseEnvFile(a);
    const pb = parseEnvFile(b);
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
    // Same key set (form is stable) — only the minted values differ.
    expect(Object.keys(pa).sort()).toEqual(Object.keys(pb).sort());
    expect(pa.JWT_ACCESS_SECRET).not.toEqual(pb.JWT_ACCESS_SECRET);
    expect(pa.METRICS_TOKEN).not.toEqual(pb.METRICS_TOKEN);
  });

  it('writes the file with mode 0600', () => {
    const envPath = path.join(freshDir('mode'), '.env');
    expect(runGenEnv(['--env-file', envPath]).status).toBe(0);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });
});

describe('deploy/gen-env.sh vs a raw `cp .env.example .env` (the provisioning hole)', () => {
  it('check mode reports METRICS_TOKEN missing, exits non-zero, and does NOT touch the file', () => {
    const envPath = path.join(freshDir('example-check'), '.env');
    fs.copyFileSync(ENV_EXAMPLE, envPath);
    const before = fs.readFileSync(envPath);

    const run = runGenEnv(['--env-file', envPath]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('METRICS_TOKEN');
    expect(fs.readFileSync(envPath).equals(before)).toBe(true);
  });

  it('a raw .env.example copy is REJECTED by validateEnv in production (the CI negative control)', () => {
    const envPath = path.join(freshDir('example-reject'), '.env');
    fs.copyFileSync(ENV_EXAMPLE, envPath);
    // ПРИЧИНА СМЕНИЛАСЬ ВМЕСТЕ С КОНТРАКТОМ (находка №174, решение держателя 31.08.2026): прежде
    // сырую копию отвергала ФОРМА («METRICS_TOKEN: required in production» — значение было пусто),
    // теперь её отвергает ИМЯ — заполненная заглушка форму проходит, а замок при ней СЛАБЕЕ, чем
    // при пустом значении. Ось сторожит ту же способность («путь cp отвергается при старте»),
    // но по новому основанию, и это записано, а не подогнано молча.
    const отказ = (() => {
      try {
        validateEnv(parseEnvFile(envPath));
        return null;
      } catch (e: unknown) {
        return e instanceof Error ? e.message : String(e);
      }
    })();
    expect(отказ).not.toBeNull();
    expect(отказ).toContain('METRICS_TOKEN');
    expect(отказ).toContain('ЗАГЛУШКА ШАБЛОНА');
    // и отказ НЕ печатает само значение — правило разглашения держится и на заглушке
    expect(отказ).not.toContain('__change_me_32_hex_or_longer__');
  });

  it('--fill-missing tops it up without re-minting existing values, and the result validates', () => {
    const envPath = path.join(freshDir('example-fill'), '.env');
    fs.copyFileSync(ENV_EXAMPLE, envPath);
    const before = parseEnvFile(envPath);

    const fill = runGenEnv(['--env-file', envPath, '--fill-missing']);
    expect(fill.status).toBe(0);

    const after = parseEnvFile(envPath);
    // Existing REAL values survive verbatim — no secret is rotated behind the operator's back.
    // ЗАГЛУШКА ШАБЛОНА ИЗ ЭТОГО ПРАВИЛА ИСКЛЮЧЕНА (находка №174): `__change_me__` — не значение, а
    // прямое объявление «здесь ещё не подставлено». Держать её как «существующее значение» значило
    // бы, что канонический путь пополнения обходит РОВНО те ключи, ради которых его и зовут.
    const заглушка = (v: string) => v.includes('__change_me') || v.includes('__CHANGE_ME');
    for (const [key, value] of Object.entries(before)) {
      if (value !== '' && !заглушка(value)) expect(after[key]).toBe(value);
    }
    // 🔴 НЕСУЩЕЕ: ни одной заглушки не осталось — ни в обязательных ключах, ни в кредах провайдеров
    // (последние становятся ПУСТЫМИ, то есть stub-режимом, как объявлено в шапке генератора).
    // МУТАНТ (красное-до): снять `is_placeholder` из load_existing — заглушки доживают до файла.
    const выжившие = Object.entries(after)
      .filter(([, v]) => заглушка(v))
      .map(([k]) => k);
    expect(выжившие).toEqual([]);
    expect(after.METRICS_TOKEN.length).toBeGreaterThanOrEqual(16);
    expect(() => validateEnv(after)).not.toThrow();

    // And a second --fill-missing is a no-op.
    const bytes = fs.readFileSync(envPath);
    expect(runGenEnv(['--env-file', envPath, '--fill-missing']).status).toBe(0);
    expect(fs.readFileSync(envPath).equals(bytes)).toBe(true);
  });
});
