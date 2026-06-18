import { Logger } from '@nestjs/common';
import { fetchJson } from '../http.util';
import { ProviderError } from '../provider-error';
import type { GeocodeResult, MapsProvider } from './maps-provider.port';

/** Minimal slice of the Yandex Geocoder JSON response. */
interface YandexGeocodeResponse {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{
        GeoObject?: {
          Point?: { pos?: string };
          metaDataProperty?: { GeocoderMetaData?: { text?: string } };
        };
      }>;
    };
  };
}

const ENDPOINT = 'https://geocode-maps.yandex.ru/1.x/';

/** Yandex.Maps geocoder adapter (ADR-0008 default). */
export class YandexMapsAdapter implements MapsProvider {
  private readonly logger = new Logger(YandexMapsAdapter.name);

  constructor(private readonly apiKey: string) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({
      apikey: this.apiKey,
      geocode: query,
      format: 'json',
      results: '1',
    });

    const data = await fetchJson<YandexGeocodeResponse>('yandex-maps', `${ENDPOINT}?${params.toString()}`);
    const geoObject = data.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const pos = geoObject?.Point?.pos;
    if (!pos) {
      this.logger.debug(`No geocode match for "${query}"`);
      return null;
    }

    // Yandex returns "lon lat" (longitude first).
    const [lonStr, latStr] = pos.split(' ');
    const lon = Number(lonStr);
    const lat = Number(latStr);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      throw new ProviderError('yandex-maps', 'response', `unparseable point "${pos}"`);
    }

    return {
      point: { lat, lon },
      formattedAddress: geoObject?.metaDataProperty?.GeocoderMetaData?.text ?? query,
    };
  }
}
