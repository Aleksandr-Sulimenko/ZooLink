import { Logger } from '@nestjs/common';
import type { GeocodeResult, MapsProvider } from './maps-provider.port';

/**
 * Dev/test maps adapter used when no Yandex key is configured. Returns null so callers
 * exercise their graceful-degradation path (e.g. fall back to stored city coordinates /
 * haversine distance per integrations.md §3) instead of failing.
 */
export class StubMapsProvider implements MapsProvider {
  private readonly logger = new Logger('StubMapsProvider');

  async geocode(query: string): Promise<GeocodeResult | null> {
    this.logger.warn(`[STUB] geocode("${query}") → null (no maps provider configured)`);
    return Promise.resolve(null);
  }
}
