/** Geocoding for geo-search. Vendor: Yandex.Maps (ADR-0008). */
export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeocodeResult {
  point: GeoPoint;
  formattedAddress: string;
}

export interface MapsProvider {
  /** Resolve a free-text place (city/region) to a point, or null when not found. */
  geocode(query: string): Promise<GeocodeResult | null>;
}
