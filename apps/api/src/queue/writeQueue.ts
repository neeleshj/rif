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
 *   SIGTERM via the server's onClose hook. A drain against a healthy database
 *   flushes every buffered record. A drain against an unavailable one gives up
 *   fast (see drain() below) rather than retrying batch by batch.
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
  /**
   * Stop the worker and flush everything still buffered. Bounded: it gives up on
   * the first flush failure or at drainTimeoutMs, whichever comes first, and
   * discards the rest rather than retrying against a dead database.
   */
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
    /** Overall wall-clock budget for drain() on shutdown. */
    drainTimeoutMs: number;
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
  // A single in-flight flush at a time; callers await the same promise. Resolves
  // true when the pass emptied the buffer, false when a batch failed.
  let activeFlush: Promise<boolean> | null = null;
  // Set once drain() has given up, so an in-flight pass stops taking new batches
  // instead of racing the discard below for the same records.
  let stopped = false;
  // The batch currently inside sql.begin. It is already out of the buffer, so if
  // drain() gives up while a flush hangs, this is the only handle left on those
  // records: without it their counters would never be rolled back. `settled`
  // marks who accounted for the batch, so it is rolled back exactly once.
  let inFlight: { counts: BatchTally; size: number; settled: boolean } | null = null;

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

  /** Flush batches until the buffer is empty. Resolves false if a batch failed. */
  async function doFlush(): Promise<boolean> {
    while (buffer.length > 0 && !stopped) {
      const batch = buffer.splice(0, config.batchSize);
      const counts = tally(batch);
      const entry = { counts, size: batch.length, settled: false };
      inFlight = entry;
      try {
        await flushBatch(batch, counts);
        if (inFlight === entry) inFlight = null;
        // A drain deadline may have fired mid-flight and already rolled this
        // batch back. The rows are durable, so the counters now under-report
        // until the next restart re-seeds them from dna_stats. That errs on the
        // safe side (never claiming more than is stored) and the process is on
        // its way out regardless.
        if (entry.settled) return false;
      } catch (err) {
        if (inFlight === entry) inFlight = null;
        // Already accounted for by abandonInFlight(); do not roll back twice.
        if (entry.settled) return false;
        entry.settled = true;
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
        return false;
      }
    }
    return true;
  }

  function flush(): Promise<boolean> {
    if (activeFlush) return activeFlush;
    activeFlush = doFlush().finally(() => {
      activeFlush = null;
    });
    return activeFlush;
  }

  /**
   * Discard everything still buffered, rolling the counters back by its tally so
   * the in-memory stats never claim more than is durably stored. Used only once
   * drain() has decided the database is not coming back in time.
   */
  function discardBuffer(reason: string): number {
    if (buffer.length === 0) return 0;
    const lost = buffer.splice(0, buffer.length);
    const counts = tally(lost);
    onFlushFailure?.(counts);
    logger.error(
      {
        reason,
        dropped: lost.length,
        rolledBackMutants: counts.mutants,
        rolledBackHumans: counts.humans,
      },
      'write queue drain gave up: buffered records dropped and counters rolled back',
    );
    return lost.length;
  }

  /**
   * Roll back the batch parked inside a flush we are about to walk away from.
   * It left the buffer before it hung, so discardBuffer() cannot see it, and
   * without this its counts would survive as an over-report.
   */
  function abandonInFlight(): number {
    const entry = inFlight;
    if (!entry || entry.settled) return 0;
    entry.settled = true; // doFlush will skip its own rollback when it settles
    inFlight = null;
    onFlushFailure?.(entry.counts);
    logger.error(
      {
        dropped: entry.size,
        rolledBackMutants: entry.counts.mutants,
        rolledBackHumans: entry.counts.humans,
      },
      'write queue drain abandoned an in-flight batch: counters rolled back',
    );
    return entry.size;
  }

  /** Resolve `value` or, after `ms`, resolve `onTimeout`. Never keeps the loop alive. */
  function withDeadline<T>(value: Promise<T>, ms: number, onTimeout: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const t = setTimeout(() => resolve(onTimeout), ms);
      t.unref();
      void value.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        () => {
          clearTimeout(t);
          resolve(onTimeout);
        },
      );
    });
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

      // Shutdown must be bounded. A healthy pass empties the buffer in one go
      // (doFlush loops internally), so the loop below normally runs once; it
      // re-checks only to catch records enqueued alongside an in-flight pass.
      //
      // When the database is gone, retrying batch by batch is pure cost: each
      // attempt pays the full connect/query timeout and every record is dropped
      // anyway. So we stop at the FIRST failure, and cap the whole drain with a
      // deadline in case a single flush hangs rather than failing. Whatever is
      // left is discarded loudly, with the counters rolled back to match.
      const started = Date.now();
      const deadline = started + config.drainTimeoutMs;
      let dropped = 0;
      while (buffer.length > 0 || activeFlush) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          stopped = true;
          dropped = discardBuffer('drain timeout exceeded') + abandonInFlight();
          break;
        }
        // `false` on timeout: treat a hung flush exactly like a failed one.
        const ok = await withDeadline(flush(), remaining, false);
        if (!ok) {
          stopped = true;
          // abandonInFlight() is a no-op when the flush actually failed (it rolled
          // its own batch back); it only bites when the deadline beat a hung one.
          dropped = discardBuffer('flush failed during drain') + abandonInFlight();
          break;
        }
      }
      logger.info({ dropped, durationMs: Date.now() - started }, 'write queue drained');
    },

    size(): number {
      return buffer.length;
    },
  };
}
