/**
 * The mutant check. Pure and dependency-free: it assumes a well-formed, already
 * normalised N x N grid of A/T/C/G (validation lives at the HTTP layer).
 *
 * A grid is a mutant only with more than one sequence of SEQUENCE_LENGTH-or-more
 * identical letters in a straight line, counting each maximal run once across
 * four directions (right, down, down-right, down-left). Early-exit the instant
 * the second sequence is found: two is always enough.
 *
 * SEQUENCE_LENGTH comes from @rif/shared, the single definition of the rule that
 * MIN_GRID_SIZE is also derived from, so the two can never drift apart.
 *
 * O(N^2) time, O(1) extra space. See the README dev log Algorithm section.
 */

import { SEQUENCE_LENGTH } from '@rif/shared';

/** [dr, dc] for the four forward directions scanned from each cell. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // horizontal, right
  [1, 0], // vertical, down
  [1, 1], // diagonal, down-right
  [1, -1], // diagonal, down-left
];

function inBounds(r: number, c: number, n: number): boolean {
  return r >= 0 && r < n && c >= 0 && c < n;
}

export function isMutant(dna: string[]): boolean {
  const n = dna.length;
  if (n < SEQUENCE_LENGTH) return false;

  let sequences = 0;

  for (let r = 0; r < n; r++) {
    const row = dna[r] as string;
    for (let c = 0; c < n; c++) {
      const letter = row[c] as string;

      for (const [dr, dc] of DIRECTIONS) {
        // Skip if there is no room for a full-length run in this direction. A
        // qualifying run always has its start with SEQUENCE_LENGTH cells ahead,
        // so this misses nothing.
        const reach = SEQUENCE_LENGTH - 1;
        if (!inBounds(r + reach * dr, c + reach * dc, n)) continue;

        // Only start counting at the beginning of a run; if the previous cell in
        // this direction holds the same letter, we are mid-run, so skip.
        const pr = r - dr;
        const pc = c - dc;
        if (inBounds(pr, pc, n) && (dna[pr] as string)[pc] === letter) continue;

        // Measure the run length forward from here.
        let length = 1;
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc, n) && (dna[nr] as string)[nc] === letter) {
          length += 1;
          nr += dr;
          nc += dc;
        }

        if (length >= SEQUENCE_LENGTH) {
          sequences += 1;
          if (sequences === 2) return true; // two is enough, stop
        }
      }
    }
  }

  return false;
}
