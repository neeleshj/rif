/**
 * Pure helpers for the single grid-state model shared by the three input modes
 * (grid editor, paste parser, random generator). Kept free of React so they can
 * be unit-tested directly.
 *
 * A grid is a square array of rows, each row an array of single-character cells.
 * A cell is either '' (empty, still being filled) or one uppercase base. Storing
 * per-cell (rather than one string per row) is what lets the grid editor address
 * individual cells while paste and random converge on the same shape.
 */

import { BASES, MIN_GRID_SIZE, SEQUENCE_LENGTH, type Base } from '@rif/shared';

export type Cell = '' | Base;
export type Grid = Cell[][];

const BASE_SET = new Set<string>(BASES);

/** Is a single character one of the four valid bases (after uppercasing)? */
export function isBase(ch: string): ch is Base {
  return BASE_SET.has(ch.toUpperCase());
}

/** An n x n grid of empty cells. */
export function createGrid(n: number): Grid {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => '' as Cell));
}

/** Set a single cell immutably, returning a new grid. */
export function setCell(grid: Grid, r: number, c: number, value: Cell): Grid {
  return grid.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row));
}

/** Collapse the grid to the DNA payload shape (`string[]`), one string per row. */
export function gridToDna(grid: Grid): string[] {
  return grid.map((row) => row.join(''));
}

/** Every cell holds a base (the grid is ready to submit). */
export function isGridComplete(grid: Grid): boolean {
  return grid.length > 0 && grid.every((row) => row.every((cell) => cell !== ''));
}

/** Count of still-empty cells, for a friendly "N remaining" hint. */
export function emptyCount(grid: Grid): number {
  let count = 0;
  for (const row of grid) for (const cell of row) if (cell === '') count += 1;
  return count;
}

/**
 * Load rows into a grid, one cell per character.
 *
 * This keeps every character it is given: it used to size the grid at
 * rows.length by rows.length and silently drop anything past that column, so a
 * 4 by 6 paste quietly became a 4 by 4 grid and the user got a verdict on DNA
 * they never entered. Callers validate squareness first (see `validateDna`),
 * and reshaping input is not this function's job either way.
 */
export function rowsToGrid(rows: string[]): Grid {
  return rows.map((row) => Array.from(row, (ch) => ch as Cell));
}

export type ParseResult = { ok: true; rows: string[] } | { ok: false; error: string };

/**
 * Parse pasted text into rows. Accepts either a JSON array of strings
 * (e.g. `["ATGC", ...]`) or newline-separated rows. Uppercases everything and
 * drops blank lines. Does not enforce squareness or the alphabet; that is left to
 * `validateDna` so the caller can surface one consistent message.
 */
export function parsePaste(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Nothing to parse. Paste rows of DNA or a JSON array.' };
  }

  let rows: string[];
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: 'That looks like JSON but could not be parsed.' };
    }
    if (!Array.isArray(parsed) || parsed.some((row) => typeof row !== 'string')) {
      return { ok: false, error: 'JSON must be an array of strings, e.g. ["ATGC", "CAGT"].' };
    }
    rows = (parsed as string[]).map((row) => row.trim().toUpperCase()).filter((row) => row !== '');
  } else {
    rows = trimmed
      .split(/\r?\n/)
      .map((row) => row.trim().toUpperCase())
      .filter((row) => row !== '');
  }

  if (rows.length === 0) {
    return { ok: false, error: 'No non-empty rows found.' };
  }

  return { ok: true, rows };
}

/** Source of randomness, injectable so tests can generate deterministically. */
export type Rng = () => number;

/** The four directions a sequence can run in, as (row, column) steps. */
const RUN_DIRECTIONS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
] as const;

/** One way to lay a run on the grid: the exact cells it would occupy. */
export interface Placement {
  cells: readonly (readonly [number, number])[];
}

/** Uniform choice from a non-empty list. */
function pick<T>(items: readonly T[], rng: Rng): T {
  // Math.min guards the rng returning exactly 1, which Math.random never does
  // but an injected one might.
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

/**
 * Every in-bounds placement of a run on an n x n grid. Empty when n is below
 * MIN_GRID_SIZE, since no run fits at all.
 *
 * Exported so the tests can assert the invariant `randomGrid` leans on: every
 * placement has at least one other placement it does not overlap.
 */
export function runPlacements(n: number): Placement[] {
  const out: Placement[] = [];
  const last = SEQUENCE_LENGTH - 1;
  for (const [dr, dc] of RUN_DIRECTIONS) {
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        const endR = r + dr * last;
        const endC = c + dc * last;
        if (endR < 0 || endR >= n || endC < 0 || endC >= n) continue;
        out.push({
          cells: Array.from(
            { length: SEQUENCE_LENGTH },
            (_, k) => [r + dr * k, c + dc * k] as const,
          ),
        });
      }
    }
  }
  return out;
}

/** Do two placements share any cell? Exported alongside `runPlacements`. */
export function overlaps(a: Placement, b: Placement): boolean {
  return a.cells.some(([ar, ac]) => b.cells.some(([br, bc]) => ar === br && ac === bc));
}

/**
 * The bases that would complete a run of four ending at (r, c), given the cells
 * already placed. Filling the grid row by row means a run can only ever be
 * closed by its last cell in that order, so looking backwards along the four
 * directions sees every run this cell could complete.
 *
 * Exported for tests: this is the whole reason a generated human is a human.
 */
export function blockedBases(grid: Grid, r: number, c: number): Set<Cell> {
  const blocked = new Set<Cell>();
  for (const [dr, dc] of RUN_DIRECTIONS) {
    let base: Cell | undefined;
    let unbroken = true;
    for (let k = 1; k < SEQUENCE_LENGTH && unbroken; k += 1) {
      const cell = grid[r - dr * k]?.[c - dc * k];
      if (cell === undefined || cell === '') unbroken = false;
      else if (base === undefined) base = cell;
      else if (cell !== base) unbroken = false;
    }
    if (unbroken && base !== undefined) blocked.add(base);
  }
  return blocked;
}

/**
 * One attempt at an n x n grid with no run of four anywhere. Returns null if a
 * cell has all four bases blocked, which takes four different three-in-a-rows
 * meeting on one cell. That is rare but reachable, so the attempt is abandoned
 * rather than allowed to place a run the caller did not ask for.
 */
function tryRunFreeGrid(n: number, rng: Rng): Grid | null {
  const grid: Grid = Array.from({ length: n }, () => Array.from({ length: n }, () => '' as Cell));
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const blocked = blockedBases(grid, r, c);
      const allowed = BASES.filter((base) => !blocked.has(base));
      if (allowed.length === 0) return null;
      grid[r]![c] = pick(allowed, rng);
    }
  }
  return grid;
}

/** An n x n grid of random bases that contains no run of four. */
function runFreeGrid(n: number, rng: Rng): Grid {
  for (;;) {
    const grid = tryRunFreeGrid(n, rng);
    if (grid !== null) return grid;
  }
}

/**
 * A random n x n grid, mutant or human as asked, by construction rather than by
 * luck.
 *
 * The base grid is always generated run-free, so `wantMutant: false` is a human
 * every time. A plain random fill was not: its chance of stumbling into two runs
 * grows with n, and the button promises a human.
 *
 * For `wantMutant: true` we then plant two runs on cells that provably do not
 * overlap, so the second can never overwrite the first. Both survive, and two
 * runs on a grid that had none is "more than one sequence", which is the API's
 * definition of a mutant. Planting each run with an independent random position
 * used to let the second land on top of the first, leaving one run and a 403
 * from a button that said "mutant".
 *
 * Note this does not re-implement the detector, which lives in the API. The
 * guarantee comes from how the cells are chosen.
 *
 * n < MIN_GRID_SIZE cannot hold a run at all, so no mutant exists to build and
 * the run-free grid is returned as-is. The API rejects such a grid as invalid.
 */
export function randomGrid(n: number, wantMutant: boolean, rng: Rng = Math.random): Grid {
  const grid = runFreeGrid(n, rng);
  if (!wantMutant || n < MIN_GRID_SIZE) return grid;

  const placements = runPlacements(n);
  const first = pick(placements, rng);
  // Every placement has at least one non-overlapping partner at every size the
  // editor allows, so this list is never empty. grid.test.ts asserts that
  // exhaustively rather than leaving it as a claim in a comment.
  const second = pick(
    placements.filter((placement) => !overlaps(placement, first)),
    rng,
  );

  for (const placement of [first, second]) {
    const base = pick(BASES, rng);
    for (const [r, c] of placement.cells) grid[r]![c] = base;
  }
  return grid;
}
