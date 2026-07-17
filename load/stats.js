/**
 * Load test for the read path: GET /stats/.
 *
 * What this demonstrates (see the README dev log Scalability section):
 *   - Reads are O(1). /stats/ is served entirely from the in-process counters
 *     (a struct in RAM), never a COUNT(*) or a table scan, so throughput is high
 *     and latency is flat and low regardless of how many rows exist.
 *   - A short-TTL cache header (Cache-Control: max-age=1) lets a CDN or reverse
 *     proxy absorb the flood in front of the origin. Locally there is no CDN, so
 *     this run shows the raw single-instance ceiling; the header is what makes
 *     the deployed origin see roughly one request per second per edge node.
 *
 * Expect substantially higher req/s and lower latency than the write path: this
 * route does no work beyond formatting three integers.
 *
 * Config via env:
 *   URL            target base URL           default http://localhost:3001
 *   CONNECTIONS    concurrent connections    default 100
 *   DURATION       seconds                   default 15
 *   PIPELINING     requests in flight/conn   default 10
 */

import autocannon from 'autocannon';

const URL = process.env.URL ?? 'http://localhost:3001';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const DURATION = Number(process.env.DURATION ?? 15);
const PIPELINING = Number(process.env.PIPELINING ?? 10);

console.log(
  `GET ${URL}/stats/  connections=${CONNECTIONS} pipelining=${PIPELINING} duration=${DURATION}s`,
);

const target = `${URL.replace(/\/$/, '')}/stats/`;

const instance = autocannon(
  {
    url: target,
    method: 'GET',
    connections: CONNECTIONS,
    pipelining: PIPELINING,
    duration: DURATION,
  },
  (err) => {
    if (err) {
      console.error('load test error:', err);
      process.exit(1);
    }
    console.log('\nLook for: high req/s and flat, low latency (cached O(1) reads).');
  },
);

autocannon.track(instance, { renderProgressBar: true, renderResultsTable: true });
