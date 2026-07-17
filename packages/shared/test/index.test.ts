import { describe, expect, it } from 'vitest';
import { BASES, normaliseDna, validateDna } from '../src/index.js';

const MAX = 1000;

describe('normaliseDna', () => {
  it('uppercases every row', () => {
    expect(normaliseDna(['atgc', 'CaGt'])).toEqual(['ATGC', 'CAGT']);
  });

  it('leaves already-uppercase rows untouched', () => {
    expect(normaliseDna(['ATGC'])).toEqual(['ATGC']);
  });

  it('does not validate, only normalises', () => {
    expect(normaliseDna(['axgc'])).toEqual(['AXGC']);
  });
});

describe('validateDna', () => {
  it('accepts a well-formed square grid', () => {
    const dna = ['ATGC', 'CAGT', 'TTAT', 'AGAA'];
    expect(validateDna(dna, MAX)).toEqual({ valid: true, dna });
  });

  it('rejects N < 4: it cannot contain a sequence of four, so it is not evaluable', () => {
    const result = validateDna(['AT', 'GC'], MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toMatch(/too small/i);
  });

  it('accepts N exactly at the minimum', () => {
    const dna = ['ATGC', 'CGTA', 'TACG', 'GCAT'];
    expect(validateDna(dna, MAX)).toEqual({ valid: true, dna });
  });

  it('accepts every allowed base', () => {
    // A square grid whose rows are rotations of BASES, so all four appear.
    const dna = BASES.map((_, i) => [...BASES.slice(i), ...BASES.slice(0, i)].join(''));
    expect(validateDna(dna, MAX).valid).toBe(true);
  });

  it('rejects a non-array', () => {
    const result = validateDna('ATGC', MAX);
    expect(result.valid).toBe(false);
  });

  it('rejects an empty array', () => {
    expect(validateDna([], MAX).valid).toBe(false);
  });

  it('rejects a non-string row', () => {
    const result = validateDna(['ATGC', 42, 'TTAT', 'AGAA'], MAX);
    expect(result.valid).toBe(false);
  });

  it('rejects a non-square grid', () => {
    const result = validateDna(['ATGC', 'CAG', 'TACG', 'GCAT'], MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toMatch(/square/i);
  });

  it('rejects characters outside ATCG', () => {
    const result = validateDna(['ATGX', 'CAGT', 'TTAT', 'AGAA'], MAX);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toMatch(/invalid character/i);
  });

  it('rejects lowercase, since validation expects normalised input', () => {
    expect(validateDna(['atgc', 'cagt', 'ttat', 'agaa'], MAX).valid).toBe(false);
  });

  it('rejects a grid larger than the cap', () => {
    const dna = Array.from({ length: 5 }, () => 'ATGCA');
    const result = validateDna(dna, 4);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toMatch(/too large/i);
  });

  it('accepts a grid exactly at the cap', () => {
    const dna = Array.from({ length: 4 }, () => 'ATGC');
    expect(validateDna(dna, 4).valid).toBe(true);
  });
});
