/**
 * Unit tests for the isMutant algorithm. Grids were validated against a
 * per-direction sequence counter so each case exercises exactly what it claims
 * (see the scratch verification during authoring). isMutant assumes a
 * normalised, validated, square grid; validation is covered in validation.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { isMutant } from '../src/algorithm/isMutant.js';

describe('isMutant', () => {
  it('flags the spec mutant example (diagonal AAAA, vertical GGGG, horizontal CCCC)', () => {
    const dna = ['ATGCGA', 'CAGTGC', 'TTATGT', 'AGAAGG', 'CCCCTA', 'TCACTG'];
    expect(isMutant(dna)).toBe(true);
  });

  it('rejects a clear non-mutant (no sequence of four)', () => {
    const dna = ['ATGCGA', 'CAGTGC', 'TTATTT', 'AGACGG', 'GCGTCA', 'TCACTG'];
    expect(isMutant(dna)).toBe(false);
  });

  it('is false at the boundary: exactly one sequence is not enough', () => {
    // Only the top row AAAA forms a run; nothing else reaches four.
    const dna = ['AAAA', 'TCGT', 'GTCG', 'CGTC'];
    expect(isMutant(dna)).toBe(false);
  });

  describe('each direction can produce a sequence (two same-direction runs -> mutant)', () => {
    it('horizontal', () => {
      const dna = ['AAAA', 'CCCC', 'GTGT', 'TGTG'];
      expect(isMutant(dna)).toBe(true);
    });

    it('vertical', () => {
      const dna = ['ACGT', 'ACGT', 'ACGT', 'ACGT'];
      expect(isMutant(dna)).toBe(true);
    });

    it('diagonal down-right', () => {
      const dna = ['AGTCT', 'TAGCT', 'CTAGC', 'TCTAG', 'CTCTA'];
      expect(isMutant(dna)).toBe(true);
    });

    it('diagonal down-left', () => {
      const dna = ['TACCT', 'GCTTT', 'TATTA', 'TTTCT', 'GTGGG'];
      expect(isMutant(dna)).toBe(true);
    });
  });

  it('counts a long run (six) only once, so on its own it is not a mutant', () => {
    // The top row is a run of six identical letters: one maximal sequence, not
    // three overlapping windows. Nothing else reaches four.
    const dna = ['AAAAAA', 'TGGCCT', 'TCCCTG', 'CGGGTC', 'TGGCCG', 'CCGTCG'];
    expect(isMutant(dna)).toBe(false);
  });

  it('is a mutant with two separate runs (one horizontal, one vertical)', () => {
    const dna = ['CTAGCG', 'AAGGGG', 'CGAGGG', 'AGTACA', 'GGGCGA', 'AGAACG'];
    expect(isMutant(dna)).toBe(true);
  });

  it('is false when N < 4 even if every letter is identical', () => {
    expect(isMutant(['AAA', 'AAA', 'AAA'])).toBe(false);
    expect(isMutant(['A'])).toBe(false);
    expect(isMutant([])).toBe(false);
  });
});
