/**
 * UI-side constants for the DNA grid editor. These bound the interactive grid so
 * it stays usable; the Fastify backend remains the authoritative validator and
 * enforces its own MAX_GRID_SIZE.
 */

import { MIN_GRID_SIZE } from '@rif/shared';

/**
 * Smallest valid grid. A grid below this cannot physically contain a four-length
 * run, and the API rejects one as a validation error (400) rather than answering
 * "not a mutant" (403), which keeps unevaluable inputs out of the stats. So this
 * is a contract rule, not just an editor guardrail: the size stepper clamps here
 * and the paste path rejects anything smaller instead of submitting it.
 *
 * Re-exported from the shared contract rather than redeclared, so the bound has
 * one definition. `validateDna` enforces the same rule on the submit path and
 * stays the authority; this is for the controls that need the number up front.
 */
export const MIN_N = MIN_GRID_SIZE;
export const MAX_N = 12;
export const DEFAULT_N = 6;

/** How many grids the bulk generator submits, and how many it keeps in flight. */
export const BULK_COUNT = 100;
export const BULK_CONCURRENCY = 8;

/**
 * Upper bound handed to the shared `validateDna` helper for client-side checks.
 * Kept above MAX_N so the editor never trips the "grid too large" branch before
 * its own MAX_N control does; the real cap lives on the backend.
 */
export const MAX_UI_GRID = 100;
