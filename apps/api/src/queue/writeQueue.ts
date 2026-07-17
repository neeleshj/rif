/**
 * In-process write queue that takes Postgres off the request critical path. The
 * route computes a result, enqueues a record, and acks; a background worker
 * flushes records to the database in batches.
 *
 * - Bounded buffer: enqueue() returns false when full, so the route sheds load
 *   with a 503 instead of growing until OOM.
 * - Batched flush: on BATCH_SIZE records or every BATCH_INTERVAL_MS, whichever
 *   comes first, a single transaction does a multi-row INSERT into dna_records
 *   AND an UPDATE of dna_stats (increment counts, set updated_at).
 * - Graceful drain: drain() stops the timer and flushes what remains, wired to
 *   SIGTERM via the server's onClose hook.
 *
 * A hard crash still loses whatever is in memory (at-most-once for the buffer),
 * a deliberate trade documented in the dev log Scalability section.
 *
 * Because the route counts a verification at enqueue time (the fast path never
 * waits for Postgres), a dropped batch would leave the in-memory counters
 * over-reporting. onFlushFailure reports the dropped tally back to the caller so
 * it can reconcile; the queue itself stays free of any stats dependency.
 */

import type { Sql } from 'postgres';
import type { FastifyBaseLogger } from 'fastify';

export interface WriteRecord {
  /** Normalised grid rows joined by newline. */
  dna: string;
  isMutant: boolean;
  ts: number;
}

export interface WriteQueue {
  /** Buffer a record. Returns false when the buffer is full (backpressure). */
  enqueue(record: WriteRecord): boolean;
  /** Start the interval-driven batch worker. */
  start(): void;
  /** Stop the worker and flush everything still buffered. */
  drain(): Promise<void>;
  /** Current buffer depth (for tests and metrics). */
  size(): number;
}

/** The mutant/human split of a batch of records. */
export interface BatchTally {
  mutants: number;
  humans: number;
}

export interface WriteQueueDeps {
  sql: Sql;
  config: {
    queueMaxSize: number;
    batchSize: number;
    batchIntervalMs: number;
  };
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  /**
   * Called with the tally of a batch that was dropped because its flush failed.
   * The server wires this to Counters.rollback so the in-memory stats match what
   * is actually durable. Optional: a queue without it just drops silently.
   */
  onFlushFailure?: (tally: BatchTally) => void;
}

/** Count the mutant/human split of a batch. Pure. */
function tally(batch: WriteRecord[]): BatchTally {
  let mutants = 0;
  let humans = 0;
  for (const record of batch) {
    if (record.isMutant) mutants += 1;
    else humans += 1;
  }
  return { mutants, humans };
}

export function createWriteQueue({
  sql,
  config,
  logger,
  onFlushFailure,
}: WriteQueueDeps): WriteQueue {
  const buffer: WriteRecord[] = [];
  let timer: NodeJS.Timeout | undefined;
  // A single in-flight flush at a time; callers await the same promise.
  let activeFlush: Promise<void> | null = null;

  async function flushBatch(batch: WriteRecord[], counts: BatchTally): Promise<void> {
    const { mutants, humans } = counts;
    const rows = batch.map((record) => ({ dna: record.dna, is_mutant: record.isMutant }));

    // Records and counters move together, so durable rows and the persisted
    // counters stay exactly consistent.
    await sql.begin(async (tx) => {
      await tx`INSERT INTO dna_records ${tx(rows, 'dna', 'is_mutant')}`;
      await tx`
        UPDATE dna_stats
        SET count_mutant = count_mutant + ${mutants},
            count_human = count_human + ${humans},
            updated_at = now()
        WHERE id = true
      `;
    });
  }

  async function doFlush(): Promise<void> {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, config.batchSize);
      const counts = tally(batch);
      try {
        await flushBatch(batch, counts);
      } catch (err) {
        // The batch is already out of the buffer, so it is lost (at-most-once).
        // We do not re-buffer it: a persistent failure would then grow the
        // buffer without bound, defeating the very cap that makes load shedding
        // work. Instead, roll the counters back so the in-memory stats match
        // what is durable, and stop this pass rather than spin.
        onFlushFailure?.(counts);
        logger.error(
          { err, dropped: batch.length, rolledBackMutants: counts.mutants, rolledBackHumans: counts.humans },
          'write queue flush failed: batch dropped and counters rolled back',
        );
        return;
      }
    }
  }

  function flush(): Promise<void> {
    if (activeFlush) return activeFlush;
    activeFlush = doFlush().finally(() => {
      activeFlush = null;
    });
    return activeFlush;
  }

  return {
    enqueue(record: WriteRecord): boolean {
      if (buffer.length >= config.queueMaxSize) return false;
      buffer.push(record);
      if (buffer.length >= config.batchSize) {
        void flush();
      }
      return true;
    },

    start(): void {
      if (timer) return;
      timer = setInterval(() => {
        void flush();
      }, config.batchIntervalMs);
      // Do not keep the process alive solely for the flush timer.
      timer.unref();
    },

    async drain(): Promise<void> {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      // Flush repeatedly until the buffer is empty, awaiting any in-flight pass.
      while (buffer.length > 0 || activeFlush) {
        await flush();
      }
      logger.info({}, 'write queue drained');
    },

    size(): number {
      return buffer.length;
    },
  };
}
