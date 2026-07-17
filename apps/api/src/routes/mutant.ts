/**
 * POST /mutant/: the write path. Normalise then validate (Fastify is the
 * authoritative validator), run isMutant, count the result, enqueue the record,
 * and ack. The durable write happens asynchronously in the batch worker.
 *
 * Error contract:
 *   400 malformed input, including a grid below MIN_GRID_SIZE (nothing written)
 *   403 evaluable DNA with fewer than two sequences (persisted)
 *   200 mutant (persisted)
 *   503 write queue full (load shed, nothing written or counted)
 *
 * Every response carries a `message` explaining the outcome, so a 403 says why
 * it is a 403 rather than leaving the caller to guess. `isMutant` stays in the
 * body: the frontend reads it.
 */

import type { FastifyInstance } from 'fastify';
import type { MutantRequest, MutantResponse } from '@rif/shared';
import { normaliseDna, validateDna } from '@rif/shared';
import { isMutant } from '../algorithm/isMutant.js';
import type { Counters } from '../stats/counters.js';
import type { WriteQueue } from '../queue/writeQueue.js';

/**
 * The 200/403 body. Extends the shared MutantResponse with an explanatory
 * message; `isMutant` is unchanged, so this is purely additive for clients.
 */
interface MutantResponseBody extends MutantResponse {
  message: string;
}

const MUTANT_MESSAGE = 'mutant detected: more than one sequence of four identical letters';
const HUMAN_MESSAGE = 'not a mutant: fewer than two sequences of four identical letters were found';

export interface MutantRouteDeps {
  counters: Counters;
  queue: WriteQueue;
  config: { maxGridSize: number };
}

/** JSON-schema for the body shape only; the grid/letter rules run in code. */
const bodySchema = {
  type: 'object',
  required: ['dna'],
  additionalProperties: false,
  properties: {
    dna: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
  },
} as const;

export function registerMutantRoute(app: FastifyInstance, deps: MutantRouteDeps): void {
  const { counters, queue, config } = deps;

  app.post('/mutant/', { schema: { body: bodySchema } }, async (req, reply) => {
    const { dna } = req.body as MutantRequest;

    // Normalise (uppercase) then validate the semantic rules.
    const normalised = normaliseDna(dna);
    const result = validateDna(normalised, config.maxGridSize);
    if (!result.valid) {
      return reply.code(400).send({ error: 'bad_request', message: result.message });
    }

    const mutant = isMutant(result.dna);
    const record = {
      dna: result.dna.join('\n'),
      isMutant: mutant,
      ts: Date.now(),
    };

    // Enqueue first: if the buffer is full we shed load and neither count nor
    // persist, so the in-memory counters stay consistent with accepted requests.
    const accepted = queue.enqueue(record);
    if (!accepted) {
      return reply
        .code(503)
        .send({ error: 'unavailable', message: 'write queue full, retry later' });
    }

    counters.increment(mutant);

    const body: MutantResponseBody = {
      isMutant: mutant,
      message: mutant ? MUTANT_MESSAGE : HUMAN_MESSAGE,
    };
    return reply.code(mutant ? 200 : 403).send(body);
  });
}
