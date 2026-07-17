import { describe, expect, it } from 'vitest';
import { parseIntEnv } from './env';

describe('parseIntEnv', () => {
  it('returns the fallback when the variable is unset', () => {
    expect(parseIntEnv({}, 'MAX_GRID_SIZE', 1000)).toBe(1000);
  });

  it('returns the fallback when the variable is an empty string', () => {
    expect(parseIntEnv({ MAX_GRID_SIZE: '' }, 'MAX_GRID_SIZE', 1000)).toBe(1000);
  });

  it('parses a valid positive integer', () => {
    expect(parseIntEnv({ MAX_GRID_SIZE: '250' }, 'MAX_GRID_SIZE', 1000)).toBe(250);
  });

  it('reads only the named key', () => {
    expect(parseIntEnv({ OTHER: '7' }, 'MAX_GRID_SIZE', 12)).toBe(12);
  });

  it.each(['0', '-5', 'abc', ' ', 'NaN'])('throws on the non-positive-integer value %o', (raw) => {
    expect(() => parseIntEnv({ MAX_GRID_SIZE: raw }, 'MAX_GRID_SIZE', 1000)).toThrow(
      /MAX_GRID_SIZE must be a positive integer/,
    );
  });

  it('names the key and the offending value in the error', () => {
    expect(() => parseIntEnv({ SOME_CAP: '-1' }, 'SOME_CAP', 10)).toThrow(
      'Environment variable SOME_CAP must be a positive integer, got "-1"',
    );
  });

  // Mirrors apps/api/src/config.ts, which also uses Number.parseInt. The two must
  // read a given value identically, so a trailing-garbage value parsing as 1000
  // is deliberate rather than an oversight.
  it('parses a trailing-garbage value the way the API config does', () => {
    expect(parseIntEnv({ MAX_GRID_SIZE: '1000n' }, 'MAX_GRID_SIZE', 12)).toBe(1000);
  });
});
