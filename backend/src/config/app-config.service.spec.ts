import { AppConfigService } from './app-config.service';
import type { Env } from './env.validation';

/**
 * isDevTokenEnabled truth table (AUDIT3 security.md #1). The DEV-ONLY master-key route is reachable
 * ONLY when BOTH conditions hold — the flag is explicitly true AND we are not in production.
 * Production hard-disables regardless of the flag (defence-in-depth).
 */
describe('AppConfigService.isDevTokenEnabled', () => {
  const make = (env: Partial<Env>): AppConfigService => {
    const fake = {
      get: <K extends keyof Env>(key: K): Env[K] => env[key] as Env[K],
    };
    return new AppConfigService(fake as never);
  };

  it.each`
    NODE_ENV         | ENABLE_DEV_TOKEN | expected
    ${'development'} | ${true}          | ${true}
    ${'test'}        | ${true}          | ${true}
    ${'development'} | ${false}         | ${false}
    ${'production'}  | ${true}          | ${false}
    ${'production'}  | ${false}         | ${false}
  `(
    'NODE_ENV=$NODE_ENV ENABLE_DEV_TOKEN=$ENABLE_DEV_TOKEN → $expected',
    ({ NODE_ENV, ENABLE_DEV_TOKEN, expected }) => {
      const svc = make({ NODE_ENV, ENABLE_DEV_TOKEN });
      expect(svc.isDevTokenEnabled).toBe(expected);
    },
  );
});
