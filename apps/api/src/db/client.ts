/**
 * The Postgres data layer client. A lightweight postgres.js connection (not an
 * ORM), for direct control of multi-row batch INSERTs and the transactional
 * counter update. One factory so tests can point it at a throwaway database.
 */

import postgres from 'postgres';
import type { Sql } from 'postgres';

export type { Sql };

export function createClient(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    // A modest pool is plenty: writes are batched by the queue worker, and
    // stats never touch the database on the read path.
    max: 10,
    // Do not spam logs with server notices (e.g. IF NOT EXISTS skips).
    onnotice: () => {},
  });
}
