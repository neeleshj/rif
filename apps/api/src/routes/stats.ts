/**
 * GET /stats/: served entirely from the in-memory counters, so it never scans
 * dna_records. The body is exactly the spec's three fields; freshness is carried
 * in headers (Cache-Control: max-age=1 for CDN absorption, Last-Modified from
 * the counters' updatedAt).
 */

import type { FastifyInstance } from 'fastify';
import type { StatsResponse } from '@rif/shared';
import type { Counters } from '../stats/counters.js';

export interface StatsRouteDeps {
  counters: Counters;
}

/** Mirror the SQL dna_ratio: human == 0 -> 0, else round(mutant/human, 4). */
function ratioOf(mutant: number, human: number): number {
  if (human === 0) return 0;
  return Math.round((mutant / human) * 10000) / 10000;
}

export function registerStatsRoute(app: FastifyInstance, deps: StatsRouteDeps): void {
  const { counters } = deps;

  app.get('/stats/', async (_req, reply) => {
    const { countMutant, countHuman, updatedAt } = counters.read();
    const body: StatsResponse = {
      count_mutant_dna: countMutant,
      count_human_dna: countHuman,
      ratio: ratioOf(countMutant, countHuman),
    };
    reply.header('Cache-Control', 'max-age=1');
    reply.header('Last-Modified', updatedAt.toUTCString());
    return reply.send(body);
  });
}
