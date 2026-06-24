import { haversineKm } from './geo.util';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 55.75, lon: 37.62 }, { lat: 55.75, lon: 37.62 })).toBeCloseTo(0, 6);
  });

  it('matches the known Moscow↔Saint Petersburg distance (~633 km)', () => {
    const moscow = { lat: 55.7558, lon: 37.6173 };
    const spb = { lat: 59.9311, lon: 30.3609 };
    expect(haversineKm(moscow, spb)).toBeGreaterThan(620);
    expect(haversineKm(moscow, spb)).toBeLessThan(645);
  });

  it('is symmetric', () => {
    const a = { lat: 10, lon: 20 };
    const b = { lat: -5, lon: 50 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});
