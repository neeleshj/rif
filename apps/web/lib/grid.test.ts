import { describe, expect, it } from 'vitest';
import { MAX_N } from '@/lib/constants';
import {
  blockedBases,
  createGrid,
  emptyCount,
  gridToDna,
  isBase,
  isGridComplete,
  overlaps,
  parsePaste,
  randomGrid,
  rowsToGrid,
  runPlacements,
  setCell,
  type Grid,
  type Rng,
} from './grid';

/**
 * Deterministic PRNG (Lehmer / minimal standard) so every randomGrid assertion
 * below is reproducible. Math.random would make the property tests flaky and
 * unactionable when they failed.
 */
function lcg(seed: number): Rng {
  const m = 2147483647;
  let state = (seed % (m - 1)) + 1;
  return () => {
    state = (state * 48271) % m;
    return (state - 1) / (m - 1);
  };
}

/**
 * Independent oracle: count runs of four identical letters in all four
 * directions. Deliberately not the production detector (which lives in the API)
 * and deliberately not shared with it, so a bug in one cannot hide in the other.
 * Obviously correct beats clever here.
 */
function countSequences(dna: string[]): number {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;
  const rows = dna.length;
  let count = 0;
  for (const [dr, dc] of directions) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < (dna[r]?.length ?? 0); c += 1) {
        const first = dna[r]![c]!;
        if (first === undefined || first === '') continue;
        let run = true;
        for (let k = 1; k < 4 && run; k += 1) {
          if (dna[r + dr * k]?.[c + dc * k] !== first) run = false;
        }
        if (run) count += 1;
      }
    }
  }
  return count;
}

describe('countSequences (the test oracle itself)', () => {
  it('finds nothing in a run-free grid', () => {
    expect(countSequences(['GTGA', 'TAAT', 'CCCG', 'TATC'])).toBe(0);
  });

  it('counts one run per direction', () => {
    expect(countSequences(['AAAA', 'CTGA', 'TCGT', 'CAAT'])).toBe(1); // horizontal
    expect(countSequences(['ATAA', 'AAGG', 'ACGA', 'ACTC'])).toBe(1); // vertical
    expect(countSequences(['ACAC', 'GACG', 'TCAT', 'TCTA'])).toBe(1); // down-right
    expect(countSequences(['AGGA', 'ACAG', 'GACA', 'AATG'])).toBe(1); // down-left
  });

  it('counts overlapping windows in a run of five', () => {
    expect(countSequences(['AAAAA', 'CTGCC', 'CAGCG', 'TTCCC', 'TATTA'])).toBe(2);
  });
});

describe('isBase', () => {
  it('accepts the four bases case-insensitively', () => {
    for (const ch of ['A', 't', 'C', 'g']) {
      expect(isBase(ch)).toBe(true);
    }
  });

  it('rejects anything outside A/T/C/G', () => {
    for (const ch of ['N', 'x', '1', ' ', '']) {
      expect(isBase(ch)).toBe(false);
    }
  });
});

describe('createGrid', () => {
  it('builds an n x n grid of empty cells', () => {
    const grid = createGrid(3);
    expect(grid).toHaveLength(3);
    expect(grid.every((row) => row.length === 3)).toBe(true);
    expect(grid.flat().every((cell) => cell === '')).toBe(true);
  });
});

describe('setCell', () => {
  it('sets a cell immutably without mutating the source grid', () => {
    const grid = createGrid(2);
    const next = setCell(grid, 0, 1, 'G');
    expect(next[0]![1]).toBe('G');
    expect(grid[0]![1]).toBe('');
    expect(next).not.toBe(grid);
  });
});

describe('gridToDna', () => {
  it('joins each row into one string', () => {
    const grid: Grid = [
      ['A', 'T'],
      ['C', 'G'],
    ];
    expect(gridToDna(grid)).toEqual(['AT', 'CG']);
  });
});

describe('isGridComplete / emptyCount', () => {
  it('reports incomplete grids and counts the empties', () => {
    const grid = setCell(createGrid(2), 0, 0, 'A');
    expect(isGridComplete(grid)).toBe(false);
    expect(emptyCount(grid)).toBe(3);
  });

  it('reports complete grids with zero empties', () => {
    const grid: Grid = [
      ['A', 'T'],
      ['C', 'G'],
    ];
    expect(isGridComplete(grid)).toBe(true);
    expect(emptyCount(grid)).toBe(0);
  });

  it('treats an empty grid as incomplete', () => {
    expect(isGridComplete([])).toBe(false);
  });
});

describe('rowsToGrid', () => {
  it('keeps every character it is given, one cell per character', () => {
    expect(rowsToGrid(['AT', 'C'])).toEqual([['A', 'T'], ['C']]);
  });

  /**
   * The regression: a 4 by 6 paste used to be sized at rows.length by
   * rows.length, dropping columns 5 and 6 so the user got a verdict on DNA they
   * never entered. Every column must survive; squareness is `validateDna`'s call.
   */
  it('keeps all six columns of a 4 by 6 input rather than truncating to 4 by 4', () => {
    const grid = rowsToGrid(['ATGCGA', 'CAGTGC', 'TTATGT', 'AGAAGG']);
    expect(grid).toHaveLength(4);
    expect(grid.every((row) => row.length === 6)).toBe(true);
    expect(gridToDna(grid)).toEqual(['ATGCGA', 'CAGTGC', 'TTATGT', 'AGAAGG']);
  });

  it('does not pad a short row out to the row count', () => {
    const grid = rowsToGrid(['ATGC', 'CAG', 'TTAG', 'GCTA']);
    expect(grid[1]).toEqual(['C', 'A', 'G']);
  });

  it('returns an empty grid for no rows', () => {
    expect(rowsToGrid([])).toEqual([]);
  });
});

describe('parsePaste', () => {
  it('parses newline-separated rows, uppercasing and dropping blanks', () => {
    const result = parsePaste('atgc\n\nCAGT\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual(['ATGC', 'CAGT']);
  });

  it('handles CRLF line endings', () => {
    const result = parsePaste('ATGC\r\nCAGT');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual(['ATGC', 'CAGT']);
  });

  it('parses a JSON array of strings', () => {
    const result = parsePaste('["atgc", "CAGT"]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual(['ATGC', 'CAGT']);
  });

  // Squareness is not parsePaste's job: it hands the rows over verbatim and
  // validateDna decides. Ragged rows must survive the parse unchanged so the
  // validator can report on what was actually pasted.
  it('passes ragged rows through untouched rather than reshaping them', () => {
    const result = parsePaste('ATG\nCAGTA');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual(['ATG', 'CAGTA']);
  });

  it('rejects empty input', () => {
    const result = parsePaste('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Nothing to parse/);
  });

  it('rejects malformed JSON that starts like an array', () => {
    const result = parsePaste('["ATGC",');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not be parsed/);
  });

  it('rejects a JSON array containing non-strings', () => {
    const result = parsePaste('["ATGC", 5]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/array of strings/);
  });

  it('rejects a JSON array that is all blanks', () => {
    const result = parsePaste('["", "  "]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No non-empty rows/);
  });
});

describe('runPlacements / overlaps', () => {
  it('has no placements below the minimum grid size', () => {
    expect(runPlacements(3)).toEqual([]);
  });

  it('lays a run of four on exactly four cells, all in bounds', () => {
    for (const placement of runPlacements(5)) {
      expect(placement.cells).toHaveLength(4);
      for (const [r, c] of placement.cells) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(5);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(5);
      }
    }
  });

  it('covers all four directions on the smallest grid that fits a run', () => {
    // A 4 x 4 grid fits 4 horizontal, 4 vertical and 1 of each diagonal.
    expect(runPlacements(4)).toHaveLength(10);
  });

  it('reports overlap only when two placements share a cell', () => {
    const [a, b] = [
      { cells: [[0, 0], [0, 1], [0, 2], [0, 3]] as const },
      { cells: [[0, 3], [1, 3], [2, 3], [3, 3]] as const },
    ];
    const disjoint = { cells: [[1, 0], [1, 1], [1, 2], [1, 3]] as const };
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(a, a)).toBe(true);
    expect(overlaps(a, disjoint)).toBe(false);
  });

  /**
   * The invariant randomGrid rests on. It picks a second placement from the
   * placements that do not overlap the first, and indexes that list without
   * guarding for empty. That is only safe if no placement is universally
   * overlapping, at any size the editor allows. Asserted exhaustively rather
   * than argued for in a comment.
   */
  it('gives every placement a non-overlapping partner at every allowed size', () => {
    for (let n = 4; n <= MAX_N; n += 1) {
      const placements = runPlacements(n);
      expect(placements.length).toBeGreaterThan(0);
      for (const placement of placements) {
        const partners = placements.filter((other) => !overlaps(other, placement));
        expect(partners.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('blockedBases', () => {
  it('blocks nothing on an empty grid', () => {
    expect(blockedBases(createGrid(4), 3, 3).size).toBe(0);
  });

  it('blocks the base that would close a horizontal run', () => {
    const grid: Grid = [['A', 'A', 'A', '']];
    expect([...blockedBases(grid, 0, 3)]).toEqual(['A']);
  });

  it('blocks the base that would close a vertical run', () => {
    const grid: Grid = [['T'], ['T'], ['T'], ['']];
    expect([...blockedBases(grid, 3, 0)]).toEqual(['T']);
  });

  it('blocks the base that would close a down-right diagonal run', () => {
    const grid: Grid = [
      ['C', 'A', 'A', 'A'],
      ['A', 'C', 'A', 'A'],
      ['A', 'A', 'C', 'A'],
      ['A', 'A', 'A', ''],
    ];
    expect(blockedBases(grid, 3, 3).has('C')).toBe(true);
  });

  it('blocks the base that would close a down-left diagonal run', () => {
    const grid: Grid = [
      ['A', 'A', 'A', 'G'],
      ['A', 'A', 'G', 'A'],
      ['A', 'G', 'A', 'A'],
      ['', 'A', 'A', 'A'],
    ];
    expect(blockedBases(grid, 3, 0).has('G')).toBe(true);
  });

  it('does not block when the preceding three cells disagree', () => {
    const grid: Grid = [['A', 'T', 'A', '']];
    expect(blockedBases(grid, 0, 3).size).toBe(0);
  });

  it('does not block when the run is broken by an empty cell', () => {
    const grid: Grid = [['A', '', 'A', '']];
    expect(blockedBases(grid, 0, 3).size).toBe(0);
  });

  it('blocks several bases at once when runs converge on one cell', () => {
    // (3,3) is preceded by three A's horizontally, three T's vertically and
    // three C's on the down-right diagonal, so three of the four bases are out.
    const grid: Grid = [
      ['C', 'G', 'G', 'T'],
      ['G', 'C', 'G', 'T'],
      ['G', 'G', 'C', 'T'],
      ['A', 'A', 'A', ''],
    ];
    expect([...blockedBases(grid, 3, 3)].sort()).toEqual(['A', 'C', 'T']);
  });
});

describe('randomGrid', () => {
  it('produces a square grid of valid bases', () => {
    const grid = randomGrid(6, false, lcg(1));
    expect(grid).toHaveLength(6);
    expect(grid.every((row) => row.length === 6)).toBe(true);
    expect(grid.flat().every((cell) => isBase(cell as string))).toBe(true);
  });

  it('is fully filled (no empty cells)', () => {
    expect(emptyCount(randomGrid(5, false, lcg(2)))).toBe(0);
  });

  it('works off Math.random when no rng is injected', () => {
    const grid = randomGrid(6, true);
    expect(countSequences(gridToDna(grid))).toBeGreaterThanOrEqual(2);
  });

  it('does not plant runs when n < 4 even if a mutant is requested', () => {
    const grid = randomGrid(3, true, lcg(3));
    expect(grid).toHaveLength(3);
    expect(grid.every((row) => row.length === 3)).toBe(true);
    expect(countSequences(gridToDna(grid))).toBe(0);
  });

  /**
   * The regression test for the bug this rewrite fixes: the two runs used to be
   * planted at independent random positions, so the second could land on top of
   * the first and "Force a mutant" produced a grid the API answered 403 to.
   *
   * Checked against an independent oracle over a spread of sizes and seeds, so a
   * direction combination that only misbehaves occasionally still gets caught.
   */
  describe('is a mutant or a human by construction, verified against the oracle', () => {
    for (let n = 4; n <= 12; n += 1) {
      it(`holds for every seed at n = ${n}`, () => {
        for (let seed = 1; seed <= 200; seed += 1) {
          const mutant = gridToDna(randomGrid(n, true, lcg(seed)));
          expect(countSequences(mutant), `mutant n=${n} seed=${seed}`).toBeGreaterThanOrEqual(2);

          const human = gridToDna(randomGrid(n, false, lcg(seed)));
          expect(countSequences(human), `human n=${n} seed=${seed}`).toBe(0);
        }
      });
    }
  });

  it('plants two intact, non-overlapping runs on a deterministic draw', () => {
    const grid = randomGrid(5, true, () => 0);

    // An rng pinned to 0 always picks the first option, so the placements are
    // the ones randomGrid itself would choose. Both runs are 'A' (BASES[0]).
    const placements = runPlacements(5);
    const first = placements[0]!;
    const second = placements.filter((p) => !overlaps(p, first))[0]!;

    expect(overlaps(first, second)).toBe(false);
    for (const [r, c] of first.cells) expect(grid[r]![c]).toBe('A');
    // The second run survives the first: this is exactly what used to fail.
    for (const [r, c] of second.cells) expect(grid[r]![c]).toBe('A');
    expect(countSequences(gridToDna(grid))).toBeGreaterThanOrEqual(2);
  });

  it('leaves the run-free base grid alone when a human is asked for', () => {
    // The old generator filled at random and hoped; the fill is now constrained,
    // so a human is a human at every size, not just the small ones.
    for (let n = 4; n <= MAX_N; n += 1) {
      expect(countSequences(gridToDna(randomGrid(n, false, lcg(n * 31))))).toBe(0);
    }
  });
});
