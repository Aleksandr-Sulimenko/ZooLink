import { paginate } from './page';

describe('paginate', () => {
  it('computes totalPages by ceiling', () => {
    const result = paginate([1, 2, 3], 25, 2, 10);
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(result.items).toEqual([1, 2, 3]);
  });

  it('handles an empty result set', () => {
    const result = paginate([], 0, 1, 20);
    expect(result.meta.totalPages).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('returns a single page when total fits in the limit', () => {
    expect(paginate([1], 1, 1, 20).meta.totalPages).toBe(1);
  });
});
