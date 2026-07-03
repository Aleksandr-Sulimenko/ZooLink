import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

/**
 * Thin, fully-typed wrapper over @nestjs/config. Inject this instead of raw ConfigService
 * so callers get compile-time keys and never deal with `string | undefined`.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }

  /**
   * The DEV-ONLY /auth/dev-token master-key route is reachable ONLY when it is explicitly enabled
   * AND we are not in production. Two independent conditions (fail-closed): the flag defaults false
   * (env.validation), and production hard-disables it regardless of the flag. AUDIT3 security.md #1.
   */
  get isDevTokenEnabled(): boolean {
    return this.get('ENABLE_DEV_TOKEN') === true && !this.isProduction;
  }
}
