import { parseDurationMs } from './refresh-token.service';

describe('parseDurationMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
  ])('parses %s', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDurationMs(' 7d ')).toBe(604_800_000);
  });

  it.each(['', '7', 'd', '7w', '-1d', 'abc'])('rejects %p', (bad) => {
    expect(() => parseDurationMs(bad)).toThrow(/Invalid duration/);
  });
});
