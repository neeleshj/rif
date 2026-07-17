/**
 * Server assembly and process lifecycle.
 *
 * buildServer wires the config, the Postgres client, the in-memory counters, and
 * the write queue into a Fastify instance (CORS, helmet, sampled pino logging, a
 * body-shape JSON schema, and a consistent error body). It is dependency-injected
 * so tests can build it against a throwaway database.
 *
 * start() loads the counters on boot, starts the batch worker, listens, and
 * installs a SIGTERM/SIGINT handler that drains the queue before exit.
 */

import { pathToFileURL } from 'node:url';
import Fastify, { LogController } from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { Sql } from 'postgres';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import { loadRootEnv } from './env.js';
import { createClient } from './db/client.js';
import { classifyStartupError, formatStartupError, redactDatabaseUrl, runDbPreflight } from './db/preflight.js';
import { Counters } from './stats/counters.js';
import { createWriteQueue } from './queue/writeQueue.js';
import type { WriteQueue } from './queue/writeQueue.js';
import { registerHealthRoute } from './routes/health.js';
import { registerStatsRoute } from './routes/stats.js';
import { registerMutantRoute } from './routes/mutant.js';
import { registerMetrics } from './metrics/metrics.js';

const ONE_MEGABYTE = 1_048_576;

export interface BuiltServer {
  app: FastifyInstance;
  counters: Counters;
  queue: WriteQueue;
}

/** Build the fully wired server. Does not connect, load, or listen. */
export function buildServer(config: Config, sql: Sql): BuiltServer {
  const app = Fastify({
    routerOptions: {
      // Both /mutant and /mutant/ resolve, sparing clients a trailing-slash trap.
      ignoreTrailingSlash: true,
    },
    // Reject oversized bodies before they reach a handler.
    bodyLimit: ONE_MEGABYTE,
    // We do our own sampled logging in the onResponse hook below, so Fastify's
    // built-in per-request lines stay off.
    logController: new LogController({ disableRequestLogging: true }),
    logger: { level: config.logLevel },
  });

  app.register(helmet);
  app.register(cors, { origin: config.webOrigin });

  const counters = new Counters();
  // The route counts at enqueue time, so a batch that fails to flush would leave
  // the counters over-reporting. Reconcile by rolling back the dropped tally.
  const queue = createWriteQueue({
    sql,
    config,
    logger: app.log,
    onFlushFailure: ({ mutants, humans }) => counters.rollback(mutants, humans),
  });

  // Prometheus metrics: latency histogram, request/mutant/human/error counters,
  // and queue-depth / buffer-fill gauges, exposed at GET /metrics. Registered
  // before the routes so its onRequest/onResponse hooks wrap every request.
  registerMetrics(app, { queue, config });

  // Sampled request logging: keep every error, sample successes so log volume
  // stays bounded at high throughput. Never log the DNA payload.
  app.addHook('onResponse', (req, reply, done) => {
    const meta = {
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      responseTimeMs: Math.round(reply.elapsedTime),
    };
    if (reply.statusCode >= 400) {
      req.log.warn(meta, 'request');
    } else if (Math.random() < config.logSampleRate) {
      req.log.info(meta, 'request');
    }
    done();
  });

  // One consistent error body { error, message }. Schema-validation failures
  // (bad body shape) become 400s here.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    const status = err.statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: err.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error', message: 'internal server error' });
  });

  registerHealthRoute(app, { sql });
  registerStatsRoute(app, { counters });
  registerMutantRoute(app, { counters, queue, config });

  // Drain the queue and close the DB on shutdown (triggered by app.close()).
  app.addHook('onClose', async () => {
    await queue.drain();
    await sql.end({ timeout: 5 });
  });

  return { app, counters, queue };
}

export async function start(): Promise<void> {
  loadRootEnv();
  const config = loadConfig();
  const sql = createClient(config.databaseUrl);
  const { app, counters, queue } = buildServer(config, sql);

  try {
    // Seeding the counters is also the connection check: it is the first query
    // the process makes, so a database that is down or unmigrated surfaces here.
    await runDbPreflight(() => counters.load(sql), {
      onRetry: (attempt, err) => {
        app.log.debug({ err, attempt }, 'database not reachable yet, retrying');
      },
    });
  } catch (err: unknown) {
    // Fail fast rather than boot degraded. The API cannot answer /mutant/ or
    // /stats/ without Postgres, and starting anyway would leave /stats/
    // reporting a confident zero that looks like real data instead of an
    // outage. Refusing to start is the honest failure.
    //
    // The raw error stays at debug level for whoever needs the stack; the
    // default level gets the short actionable message on stderr.
    app.log.debug({ err }, 'database preflight failed');
    // eslint-disable-next-line no-console
    console.error(`\n${formatStartupError(classifyStartupError(err), redactDatabaseUrl(config.databaseUrl))}\n`);
    // Close the pool so the process can exit without a dangling handle.
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  }

  queue.start();

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.apiPort, host: '0.0.0.0' });
}

// Start only when run as the entry point (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
