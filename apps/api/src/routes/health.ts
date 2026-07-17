/**
 * GET /health: a dependency-checking probe.
 *
 * A probe that only proves the process is alive would report healthy with a
 * dead database, which is useless to a load balancer. So this verifies the one
 * dependency the API has with a cheap `SELECT 1`:
 *
 *   200 { status: 'ok',    checks: { database: 'ok' } }
 *   503 { status: 'error', checks: { database: 'error' } }
 *
 * The query is raced against a short timeout, so a hung database fails the
 * probe quickly instead of hanging it. Failures resolve to an 'error' check
 * rather than throwing, so the route never leaks a raw 500.
 *
 * Liveness vs readiness: strictly, liveness should not check dependencies (a
 * dead database should not get an otherwise healthy process killed) while
 * readiness should. One dependency-checking /health is the pragmatic choice
 * here; a production setup would split /health (liveness) from /ready
 * (readiness). See the dev log Observability section.
 */

import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';

/** Cap on the probe's database query. Short: a probe must answer fast. */
export const HEALTH_DB_TIMEOUT_MS = 1000;

export interface HealthRouteDeps {
  sql: Sql;
  /** Override the database query timeout (tests use a short one). */
  timeoutMs?: number;
}

type CheckStatus = 'ok' | 'error';

/**
 * Resolve 'ok' if the database answers `SELECT 1` within timeoutMs, else
 * 'error'. Never rejects: an unreachable, erroring, or hung database is a
 * failed check, not an exception.
 */
async function checkDatabase(sql: Sql, timeoutMs: number): Promise<CheckStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CheckStatus>((resolve) => {
    timer = setTimeout(() => resolve('error'), timeoutMs);
  });
  const query: Promise<CheckStatus> = (async () => {
    await sql`SELECT 1`;
    return 'ok' as CheckStatus;
  })().catch(() => 'error' as CheckStatus);

  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealthRoute(app: FastifyInstance, deps: HealthRouteDeps): void {
  const { sql, timeoutMs = HEALTH_DB_TIMEOUT_MS } = deps;

  app.get('/health', async (req, reply) => {
    const database = await checkDatabase(sql, timeoutMs);
    if (database === 'error') {
      req.log.warn('health check failed: database unreachable');
      return reply.code(503).send({ status: 'error', checks: { database } });
    }
    return reply.send({ status: 'ok', checks: { database } });
  });
}
