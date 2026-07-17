/**
 * Prometheus metrics for the API, exposed at GET /metrics.
 *
 * This is the small local demonstration of the Observability section in the dev
 * log: metrics are primary and O(1) per scrape, logs are sampled and secondary.
 * prom-client is the idiomatic lightweight choice for a Fastify service and adds
 * no framework; it just aggregates in-process series and renders Prometheus text.
 *
 * Cardinality is deliberately bounded. The only labels are `route` (the matched
 * Fastify route pattern, never the raw URL) and `status` (the numeric code). We
 * never label with DNA, request ids, or anything unbounded, so the number of
 * series stays fixed no matter the request volume.
 *
 * A fresh Registry is created per server instance (rather than the global
 * default registry) so that building several servers in a test run does not
 * collide on duplicate metric registration.
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { FastifyInstance } from 'fastify';
import type { WriteQueue } from '../queue/writeQueue.js';

export interface MetricsDeps {
  queue: WriteQueue;
  config: { queueMaxSize: number };
}

export interface Metrics {
  /** The registry backing GET /metrics. */
  registry: Registry;
  /** Total HTTP responses, labelled by matched route and status code. */
  httpRequestsTotal: Counter<'route' | 'status'>;
  /** Verifications that came back mutant (HTTP 200 on the write path). */
  mutantTotal: Counter<string>;
  /** Verifications that came back human (HTTP 403 on the write path). */
  humanTotal: Counter<string>;
  /** Responses with a 5xx status (true server errors), excluding the load shed. */
  errorsTotal: Counter<string>;
  /** Requests shed with a 503 because the write queue was full (by design). */
  loadShedTotal: Counter<string>;
  /** Request latency in seconds, labelled by route. */
  requestDuration: Histogram<'route'>;
}

/**
 * True for the deliberate backpressure response: a 503 from the write path when
 * the bounded buffer is full. That is the system working as designed, not a
 * fault, so it must not land in rif_errors_total or every error-rate alert would
 * fire during correct load shedding. It gets its own counter instead.
 *
 * Deliberately narrow: a 503 from /health means the database is unreachable,
 * which IS a real fault and still counts as an error.
 */
function isLoadShed(route: string, statusCode: number): boolean {
  return statusCode === 503 && route === '/mutant/';
}

/** The matched route pattern, or a single bounded bucket for unmatched paths. */
function routeLabel(url: string | undefined): string {
  return url ?? 'unmatched';
}

/**
 * Build the metric set on a fresh registry. Gauges for queue depth and buffer
 * fill read live from the write queue at scrape time via a collect callback, so
 * they never drift from the real buffer state.
 */
export function createMetrics(deps: MetricsDeps): Metrics {
  const registry = new Registry();
  const { queue, config } = deps;

  const httpRequestsTotal = new Counter({
    name: 'rif_requests_total',
    help: 'Total HTTP responses by route and status.',
    labelNames: ['route', 'status'] as const,
    registers: [registry],
  });

  const mutantTotal = new Counter({
    name: 'rif_mutant_total',
    help: 'Verifications classified as mutant.',
    registers: [registry],
  });

  const humanTotal = new Counter({
    name: 'rif_human_total',
    help: 'Verifications classified as human (non-mutant).',
    registers: [registry],
  });

  const errorsTotal = new Counter({
    name: 'rif_errors_total',
    help: 'Responses with a 5xx status, excluding the by-design write-queue load shed.',
    registers: [registry],
  });

  const loadShedTotal = new Counter({
    name: 'rif_load_shed_total',
    help: 'Requests shed with a 503 because the write queue was full (backpressure, not a fault).',
    registers: [registry],
  });

  const requestDuration = new Histogram({
    name: 'rif_request_duration_seconds',
    help: 'Request handling latency in seconds, by route.',
    labelNames: ['route'] as const,
    // Buckets tuned for a fast-ack service: sub-millisecond to a few hundred ms.
    buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry],
  });

  // Gauges read the live buffer state at scrape time. queue_depth is the number
  // of records buffered; buffer_fill is that as a fraction of the bounded cap,
  // so 1.0 means the next write sheds load (503). Both are the load-bearing
  // signals from the Observability section.
  new Gauge({
    name: 'rif_queue_depth',
    help: 'Records currently buffered in the in-process write queue.',
    registers: [registry],
    collect(): void {
      this.set(queue.size());
    },
  });

  new Gauge({
    name: 'rif_buffer_fill_ratio',
    help: 'Write buffer fill as a fraction of its bounded capacity (1.0 = shedding).',
    registers: [registry],
    collect(): void {
      this.set(config.queueMaxSize > 0 ? queue.size() / config.queueMaxSize : 0);
    },
  });

  return {
    registry,
    httpRequestsTotal,
    mutantTotal,
    humanTotal,
    errorsTotal,
    loadShedTotal,
    requestDuration,
  };
}

/**
 * Wire timing and counting into the request lifecycle and expose GET /metrics.
 *
 * onRequest stamps a monotonic start time; onResponse computes the elapsed
 * seconds, observes the latency histogram, and increments the counters. All
 * labels are bounded (route pattern + status). The mutant/human split is derived
 * from the write path's status contract (200 mutant, 403 human), so the route
 * handler stays untouched.
 *
 * The write path's 503 is deliberate backpressure, so it increments
 * rif_load_shed_total rather than rif_errors_total: shed load stays observable
 * without being mistaken for a server fault. See isLoadShed above.
 */
export function registerMetrics(app: FastifyInstance, deps: MetricsDeps): Metrics {
  const metrics = createMetrics(deps);

  app.addHook('onRequest', (req, _reply, done) => {
    (req as { metricsStart?: bigint }).metricsStart = process.hrtime.bigint();
    done();
  });

  app.addHook('onResponse', (req, reply, done) => {
    const route = routeLabel(req.routeOptions?.url);
    const status = String(reply.statusCode);

    const start = (req as { metricsStart?: bigint }).metricsStart;
    if (start !== undefined) {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      metrics.requestDuration.observe({ route }, seconds);
    }

    metrics.httpRequestsTotal.inc({ route, status });

    // Backpressure is healthy behaviour, so it gets its own counter and is kept
    // out of the error total. Everything else 5xx is a genuine fault.
    if (isLoadShed(route, reply.statusCode)) {
      metrics.loadShedTotal.inc();
    } else if (reply.statusCode >= 500) {
      metrics.errorsTotal.inc();
    }

    // Derive the mutant/human counters from the write path's status contract.
    if (route === '/mutant/') {
      if (reply.statusCode === 200) metrics.mutantTotal.inc();
      else if (reply.statusCode === 403) metrics.humanTotal.inc();
    }

    done();
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });

  return metrics;
}
