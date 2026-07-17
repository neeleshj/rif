/**
 * Shared contract between the API and the frontend: the request/response types
 * and the light validation helpers both sides use. Fastify remains the
 * authoritative validator; the frontend uses these for fast feedback.
 */

export const BASES = ['A', 'T', 'C', 'G'] as const;
export type Base = (typeof BASES)[number];

/** Length of the run that counts as a sequence. */
export const SEQUENCE_LENGTH = 4;

/**
 * Smallest grid that can be evaluated. A grid below this can never contain a
 * run of SEQUENCE_LENGTH, so it is rejected as a client error rather than
 * reported "not a mutant". This is our reading of the spec, not something it
 * mandates: see the dev log API section.
 */
export const MIN_GRID_SIZE = SEQUENCE_LENGTH;

/** Request body for POST /mutant/. */
export interface MutantRequest {
  dna: string[];
}

/** Convenience body returned alongside the 200/403 status. */
export interface MutantResponse {
  isMutant: boolean;
}

/** Response body for GET /stats/ (exact spec shape). */
export interface StatsResponse {
  count_mutant_dna: number;
  count_human_dna: number;
  ratio: number;
}

/** Consistent error body for 400s. */
export interface ErrorResponse {
  error: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; dna: string[] }
  | { valid: false; message: string };

const BASE_SET = new Set<string>(BASES);

/** Uppercase every row. Does not validate. */
export function normaliseDna(dna: string[]): string[] {
  return dna.map((row) => row.toUpperCase());
}

/**
 * Validate a (already normalised) DNA grid. Returns the reason on failure.
 * Rules: non-empty array of strings, N x N square, only A/T/C/G, and N between
 * MIN_GRID_SIZE and maxGridSize.
 *
 * Note on the lower bound: a grid smaller than MIN_GRID_SIZE cannot contain a
 * sequence of four, so it cannot be evaluated against the mutant rule at all.
 * We treat that as a validation error (a 400 at the HTTP layer) rather than
 * "not a mutant" (403), which also keeps unevaluable inputs out of the stats.
 */
export function validateDna(dna: unknown, maxGridSize: number): ValidationResult {
  if (!Array.isArray(dna) || dna.length === 0) {
    return { valid: false, message: 'dna must be a non-empty array of strings' };
  }
  const n = dna.length;
  if (n < MIN_GRID_SIZE) {
    return {
      valid: false,
      message: `grid too small: N=${n} must be at least ${MIN_GRID_SIZE} to contain a sequence of ${SEQUENCE_LENGTH}`,
    };
  }
  if (n > maxGridSize) {
    return { valid: false, message: `grid too large: N=${n} exceeds ${maxGridSize}` };
  }
  for (const row of dna) {
    if (typeof row !== 'string') {
      return { valid: false, message: 'every row must be a string' };
    }
    if (row.length !== n) {
      return { valid: false, message: `grid must be square: expected each row length ${n}` };
    }
    for (const ch of row) {
      if (!BASE_SET.has(ch)) {
        return { valid: false, message: `invalid character "${ch}"; only A, T, C, G allowed` };
      }
    }
  }
  return { valid: true, dna: dna as string[] };
}
