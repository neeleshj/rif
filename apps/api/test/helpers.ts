/**
 * Shared test helpers: a fake Postgres client and a Config factory.
 *
 * Database isolation strategy (per the README dev log Testing section): the
 * intended approach for real integration tests is a dedicated local test
 * database with transaction rollback or truncate between tests, for
 * deterministic and independent runs. That is not used here because this
 * environment has no Postgres available. Instead the DB layer is mocked through
 * the dependency injection the code already provides:
 *
 *   - buildServer(config, sql)           injects the client into the server
 *   - createWriteQueue({ sql, ... })     injects it into the write queue
 *   - Counters.load(sql)                 takes the client as an argument
 *
 * makeFakeSql() returns an object that mimics the small slice of the postgres.js
 * `Sql` surface the code touches: the tagged-template call form (for SELECT), a
 * helper call form `sql(rows, ...columns)` used to build the multi-row INSERT
 * fragment, `sql.begin(fn)` for the flush transaction, and `sql.end()` for
 * shutdown. It records what each flush would have written so tests can assert
 * persistence without a database.
 */

import type { Sql } from 'postgres';
import type { Config } from '../src/config.js';

export interface FlushCapture {
  rows: Array<{ dna: string; is_mutant: boolean }>;
  mutants: number;
  humans: number;
}

export interface FakeSql {
  /** The object to pass anywhere an `Sql` is expected. */
  sql: Sql;
  /** One entry per committed flush transaction. */
  readonly flushes: FlushCapture[];
  /** Number of committed flush transactions. */
  readonly flushCount: number;
  /** True once sql.end() has been called (shutdown). */
  readonly ended: boolean;
  /** Total records across all flushes (durable rows). */
  totalPersisted(): number;
  /** Make the next flush transaction throw, to exercise the drop path. */
  failNextFlush(): void;
  /** Rows the next SELECT (Counters.load) resolves with. */
  setSelectRows(rows: unknown[]): void;
  /** Make every SELECT reject, standing in for an unreachable database. */
  failSelects(): void;
  /** Make every SELECT hang forever, standing in for a wedged database. */
  hangSelects(): void;
}

function isTemplate(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'raw');
}

interface RowsFragment {
  __rows: Array<{ dna: string; is_mutant: boolean }>;
}

export function makeFakeSql(initialSelectRows: unknown[] = []): FakeSql {
  const flushes: FlushCapture[] = [];
  let flushCount = 0;
  let failNext = false;
  let ended = false;
  let selectRows = initialSelectRows;
  let selectMode: 'ok' | 'fail' | 'hang' = 'ok';

  // Capture buffers, populated by the tagged-template calls inside a begin().
  let capInsert: Array<{ dna: string; is_mutant: boolean }> | null = null;
  let capMutants = 0;
  let capHumans = 0;

  const tag = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const text = strings.join(' ? ');
    if (text.includes('INSERT INTO dna_records')) {
      const frag = values[0] as RowsFragment;
      capInsert = frag.__rows;
    } else if (text.includes('UPDATE dna_stats')) {
      capMutants = values[0] as number;
      capHumans = values[1] as number;
    } else if (text.includes('SELECT')) {
      if (selectMode === 'fail') {
        return Promise.reject(new Error('connection refused (simulated)'));
      }
      if (selectMode === 'hang') {
        return new Promise<unknown[]>(() => {});
      }
      return Promise.resolve(selectRows);
    }
    return Promise.resolve([]);
  };

  // Dual-purpose callable: a tagged template, or the sql(rows, ...cols) helper.
  const callable = (...args: unknown[]): unknown => {
    if (isTemplate(args[0])) {
      return tag(args[0], ...args.slice(1));
    }
    return { __rows: args[0] } as RowsFragment;
  };

  const sql = callable as unknown as Sql;

  (sql as unknown as { begin: (fn: (tx: unknown) => Promise<void>) => Promise<void> }).begin = async (
    fn: (tx: unknown) => Promise<void>,
  ): Promise<void> => {
    if (failNext) {
      failNext = false;
      throw new Error('flush failed (simulated)');
    }
    capInsert = null;
    capMutants = 0;
    capHumans = 0;
    await fn(callable);
    flushCount += 1;
    flushes.push({ rows: capInsert ?? [], mutants: capMutants, humans: capHumans });
  };

  (sql as unknown as { end: (opts?: unknown) => Promise<void> }).end = async (): Promise<void> => {
    ended = true;
  };

  return {
    sql,
    flushes,
    get flushCount() {
      return flushCount;
    },
    get ended() {
      return ended;
    },
    totalPersisted() {
      return flushes.reduce((sum, f) => sum + f.rows.length, 0);
    },
    failNextFlush() {
      failNext = true;
    },
    setSelectRows(rows: unknown[]) {
      selectRows = rows;
    },
    failSelects() {
      selectMode = 'fail';
    },
    hangSelects() {
      selectMode = 'hang';
    },
  };
}

/** A valid Config for tests, with cheap-to-override knobs. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiPort: 3001,
    databaseUrl: 'postgres://test',
    nodeEnv: 'test',
    maxGridSize: 1000,
    queueMaxSize: 100000,
    // Large batch and interval so nothing auto-flushes mid-test unless asked.
    batchSize: 1000,
    batchIntervalMs: 100000,
    logLevel: 'silent',
    logSampleRate: 0,
    webOrigin: 'http://localhost:3000',
    ...overrides,
  };
}

/** A no-op logger matching the shape the write queue expects. */
export function makeLogger(): { info: () => void; error: () => void } {
  return { info: () => {}, error: () => {} };
}
