import { backoffSeconds, MAX_ATTEMPTS } from './backoff';

describe('backoffSeconds', () => {
  it('grows exponentially from the base delay', () => {
    expect(backoffSeconds(1)).toBe(10);
    expect(backoffSeconds(2)).toBe(20);
    expect(backoffSeconds(3)).toBe(40);
    expect(backoffSeconds(4)).toBe(80);
  });

  it('caps at one hour', () => {
    expect(backoffSeconds(20)).toBe(3600);
    expect(backoffSeconds(MAX_ATTEMPTS)).toBeLessThanOrEqual(3600);
  });

  it('treats attempts < 1 as the first attempt', () => {
    expect(backoffSeconds(0)).toBe(10);
    expect(backoffSeconds(-5)).toBe(10);
  });
});
