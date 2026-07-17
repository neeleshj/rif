/**
 * Unit tests for the shared normalisation and validation helpers (@rif/shared),
 * the semantic gate the mutant route runs before isMutant. Fastify checks the
 * body shape; these rules (square, alphabet, size, non-empty) run in code.
 */

import { describe, expect, it } from 'vitest';
import { normaliseDna, validateDna } from '@rif/shared';

const MAX = 1000;

describe('normaliseDna', () => {
  it('uppercases every row and does not validate', () => {
    expect(normaliseDna(['atgc', 'CaGt'])).toEqual(['ATGC', 'CAGT']);
  });

  it('leaves already-uppercase input unchanged', () => {
    expect(normaliseDna(['ATGC'])).toEqual(['ATGC']);
  });
});

describe('validateDna', () => {
  it('accepts a valid square grid and returns the rows', () => {
    const result = validateDna(['ATGC', 'CGTA', 'TACG', 'GCAT'], MAX);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.dna).toEqual(['ATGC', 'CGTA', 'TACG', 'GCAT']);
    }
  });

  it('accepts a normalised (uppercase) grid, as produced by normaliseDna', () => {
    const result = validateDna(normaliseDna(['atgc', 'cgta', 'tacg', 'gcat']), MAX);
    expect(result.valid).toBe(true);
  });

  it('rejects N < 4, which cannot contain a sequence of four', () => {
    const result = validateDna(['AT', 'CG'], MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toMatch(/too small/i);
    }
  });

  it('accepts N = 4, the smallest evaluable grid', () => {
    expect(validateDna(['ATGC', 'CGTA', 'TACG', 'GCAT'], MAX).valid).toBe(true);
  });

  it('rejects a non-square grid', () => {
    const result = validateDna(['ATGC', 'CG', 'TACG', 'GCAT'], MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toMatch(/square/i);
    }
  });

  it('rejects an invalid character (only A/T/C/G allowed)', () => {
    const result = validateDna(['ATGX', 'CGTA', 'TACG', 'GCAT'], MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toMatch(/invalid character/i);
    }
  });

  it('rejects an oversized grid beyond maxGridSize', () => {
    const oversized = Array.from({ length: 5 }, () => 'ATGCG');
    const result = validateDna(oversized, 4);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toMatch(/too large/i);
    }
  });

  it('rejects an empty array', () => {
    const result = validateDna([], MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toMatch(/non-empty/i);
    }
  });

  it('rejects a non-array input', () => {
    expect(validateDna('ATGC', MAX).valid).toBe(false);
  });

  it('rejects a row that is not a string', () => {
    const result = validateDna(['ATGC', 99, 'TACG', 'GCAT'] as unknown, MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toMatch(/must be a string/i);
    }
  });
});
