/**
 * Shared MSW server for component tests. The app fetches same-origin
 * `/api/mutant` and `/api/stats`, which happy-dom resolves against the
 * configured origin (http://localhost:3000). Default handlers return benign
 * values; individual tests override them with `server.use(...)`.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const ORIGIN = 'http://localhost:3000';

/** A resolved stats payload used as the default so StatsView can mount cleanly. */
export const DEFAULT_STATS = {
  count_mutant_dna: 0,
  count_human_dna: 0,
  ratio: 0,
};

export const handlers = [
  http.post(`${ORIGIN}/api/mutant`, () => new HttpResponse(null, { status: 403 })),
  http.get(`${ORIGIN}/api/stats`, () => HttpResponse.json(DEFAULT_STATS)),
];

export const server = setupServer(...handlers);
