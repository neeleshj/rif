/**
 * Load test for the write path: POST /mutant/.
 *
 * What this demonstrates (see the README dev log Scalability section):
 *   - Ack latency stays flat under load. The route computes isMutant, enqueues,
 *     and acks in well under a millisecond; the durable Postgres write happens
 *     off the critical path in the batched background worker. So p99 ack latency
 *     should stay low and roughly constant as the accept rate climbs, decoupled
 *     from database write throughput.
 *   - The DB write rate stays bounded. However hard we push, the worker flushes
 *     in fixed-size batches on a fixed interval, so durable writes are capped by
 *     BATCH_SIZE / BATCH_INTERVAL_MS, not by the request rate.
 *   - Backpressure sheds load rather than growing the buffer. With a small
 *     QUEUE_MAX_SIZE (or a slow / absent database) the buffer fills and further
 *     writes return 503 instead of the process growing until OOM. Run with
 *     `--saturate` (or `npm run mutant:saturate`) to provoke this: 503s are the
 *     correct, healthy behaviour here, not an error.
 *
 * Note on status accounting: a non-mutant grid is answered with 403 by design
 * (the error contract), which autocannon reports as a "non-2xx" response. This
 * script sends a MUTANT grid by default so 2xx == accepted writes and the output
 * reads cleanly. Set BODY=human to exercise the 403 path.
 *
 * Config via env:
 *   URL            target base URL           default http://localhost:3001
 *   CONNECTIONS    concurrent connections    default 50   (200 with --saturate)
 *   DURATION       seconds                   default 20   (15  with --saturate)
 *   PIPELINING     requests in flight/conn   default 1    (10  with --saturate)
 *   BODY           mutant | human            default mutant
 */

import autocannon from 'autocannon';

const saturate = process.argv.includes('--saturate');

const URL = process.env.URL ?? 'http://localhost:3001';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? (saturate ? 200 : 50));
const DURATION = Number(process.env.DURATION ?? (saturate ? 15 : 20));
const PIPELINING = Number(process.env.PIPELINING ?? (saturate ? 10 : 1));

// A 6x6 grid: MUTANT has more than one run of four; HUMAN (non-mutant) has none.
const MUTANT = ['ATGCGA', 'CAGTGC', 'TTATGT', 'AGAAGG', 'CCCCTA', 'TCACTG'];
const HUMAN = ['ATGCGA', 'CAGTGC', 'TTATTT', 'AGACGG', 'GCGTCA', 'TCACTG'];
const dna = process.env.BODY === 'human' ? HUMAN : MUTANT;

console.log(
  `POST ${URL}/mutant/  connections=${CONNECTIONS} pipelining=${PIPELINING} ` +
    `duration=${DURATION}s body=${process.env.BODY === 'human' ? 'human(403)' : 'mutant(200)'}` +
    (saturate ? '  [saturate: expect 503s]' : ''),
);

const target = `${URL.replace(/\/$/, '')}/mutant/`;

const instance = autocannon(
  {
    url: target,
    method: 'POST',
    connections: CONNECTIONS,
    pipelining: PIPELINING,
    duration: DURATION,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dna }),
  },
  (err, result) => {
    if (err) {
      console.error('load test error:', err);
      process.exit(1);
    }
    // autocannon buckets by class: 503s land in `5xx` (the only 5xx we emit),
    // and 403 (non-mutant) in `4xx`. There is no per-code key.
    const shed = result['5xx'] ?? 0;
    const nonMutant = result['4xx'] ?? 0;
    console.log('\nLook for: flat latency percentiles, and under --saturate a 5xx (503) count > 0.');
    console.log(
      `accepted 2xx: ${result['2xx']}   load shed 5xx/503: ${shed}   4xx (403 non-mutant/bad req): ${nonMutant}`,
    );
    console.log('Cross-check exact codes on the API: curl -s <URL>/metrics | grep rif_requests_total');
  },
);

autocannon.track(instance, { renderProgressBar: true, renderResultsTable: true });
