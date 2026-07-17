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

/**
 * How far the grid-size stepper goes, and nothing more. This is an ergonomics
 * bound on one control (a 40 x 40 grid of inputs is not something anyone wants to
 * click through), NOT a statement about which grids are valid. Passing it to
 * `validateDna` conflates the two and refuses input the API accepts: paste used
 * to do exactly that, so a perfectly good 16 x 16 grid could not be entered at
 * all. Validity is MAX_GRID_SIZE's job below.
 */
export const MAX_N = 12;
export const DEFAULT_N = 6;

/** How many grids the bulk generator submits, and how many it keeps in flight. */
export const BULK_COUNT = 100;
export const BULK_CONCURRENCY = 8;

/**
 * The size cap the client validates against, on every path that can produce a
 * grid: paste and submit. Mirrors the backend's own MAX_GRID_SIZE default so the
 * client never rejects a grid the API would have accepted.
 *
 * There used to be three disagreeing numbers: paste checked 12, submit checked
 * 100, and the backend checked 1000. The backend stays the authority and
 * re-checks everything; this is only for fast feedback, so it errs towards
 * letting input through to the real validator rather than second-guessing it.
 */
export const MAX_GRID_SIZE = 1000;
