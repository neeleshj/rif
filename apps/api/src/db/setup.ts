/**
 * Apply the repo-root schema.sql (tables, dna_ratio function, seed row) via the
 * postgres client. Run through `npm run db:setup`. The schema is idempotent, so
 * this is safe to run more than once.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Sql } from 'postgres';
import { createClient } from './client.js';
import { loadConfig } from '../config.js';
import { loadRootEnv } from '../env.js';

/** Absolute path to the repo-root schema.sql, resolved from this module. */
export function schemaPath(): string {
  // apps/api/src/db/setup.ts -> repo root is four levels up.
  return fileURLToPath(new URL('../../../../schema.sql', import.meta.url));
}

/** Apply the schema file to the given connection using the simple protocol. */
export async function applySchema(sql: Sql, path: string = schemaPath()): Promise<void> {
  const schema = readFileSync(path, 'utf8');
  // Simple query mode allows the multiple statements in schema.sql in one shot.
  await sql.unsafe(schema).simple();
}

async function main(): Promise<void> {
  loadRootEnv();
  const config = loadConfig();
  const sql = createClient(config.databaseUrl);
  try {
    await applySchema(sql);
    // eslint-disable-next-line no-console
    console.log('Schema applied.');
  } finally {
    await sql.end();
  }
}

// Run only when executed directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
