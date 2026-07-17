/**
 * Tests for the write queue: batched flush by size and by interval, backpressure
 * when full, counter/record consistency with what was enqueued, graceful drain
 * on shutdown, and the at-most-once drop path when a flush fails (including the
 * onFlushFailure report the server uses to reconcile its counters), plus the
 * bounded-drain behaviour against a dead or wedged database: stop at the first
 * failure, cap the whole pass with drainTimeoutMs, discard the rest loudly.
 *
 * The Postgres client is the injected fake from helpers.ts, so a "flush" is
 * observable as a recorded transaction without touching a real database.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWriteQueue } from '../src/queue/writeQueue.js';
import type { WriteRecord } from '../src/queue/writeQueue.js';
import { makeFakeSql } from './helpers.js';

function rec(isMutant: boolean, dna = 'ATGC\nCGTA\nTACG\nGCAT'): WriteRecord {
  return { dna, isMutant, ts: Date.now() };
}

function makeSpyLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

const cfg = (
  over: Partial<{ queueMaxSize: number; batchSize: number; batchIntervalMs: number; drainTimeoutMs: number }> = {},
) => ({
  queueMaxSize: 100,
  batchSize: 500,
  batchIntervalMs: 100000,
  drainTimeoutMs: 5000,
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('write queue', () => {
  it('flushes a batch as soon as the buffer reaches batchSize', async () => {
    const fake = makeFakeSql();
    const queue = createWriteQueue({ sql: fake.sql, config: cfg({ batchSize: 3 }), logger: makeSpyLogger() });

    expect(queue.enqueue(rec(true))).toBe(true);
    expect(queue.enqueue(rec(false))).toBe(true);
    expect(queue.enqueue(rec(true))).toBe(true); // third hits batchSize -> flush

    await vi.waitFor(() => expect(fake.flushCount).toBe(1));
    expect(fake.flushes[0]?.rows).toHaveLength(3);
    expect(fake.flushes[0]?.mutants).toBe(2);
    expect(fake.flushes[0]?.humans).toBe(1);
    expect(queue.size()).toBe(0);
  });

  it('flushes on the interval before batchSize is reached', async () => {
    vi.useFakeTimers();
    const fake = makeFakeSql();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ batchSize: 10, batchIntervalMs: 50 }),
      logger: makeSpyLogger(),
    });

    queue.enqueue(rec(false));
    queue.enqueue(rec(true));
    expect(fake.flushCount).toBe(0); // below batchSize, no flush yet

    queue.start();
    await vi.advanceTimersByTimeAsync(50);

    expect(fake.flushCount).toBe(1);
    expect(fake.flushes[0]?.rows).toHaveLength(2);
    await queue.drain();
  });

  it('start() is idempotent (a second call does not add a timer)', async () => {
    vi.useFakeTimers();
    const fake = makeFakeSql();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ batchSize: 10, batchIntervalMs: 50 }),
      logger: makeSpyLogger(),
    });
    queue.enqueue(rec(true));
    queue.start();
    queue.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(fake.flushCount).toBe(1); // one flush, not two
    await queue.drain();
  });

  it('sheds load: enqueue returns false when the buffer is full', () => {
    const fake = makeFakeSql();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 2, batchSize: 500 }),
      logger: makeSpyLogger(),
    });

    expect(queue.enqueue(rec(true))).toBe(true);
    expect(queue.enqueue(rec(false))).toBe(true);
    expect(queue.enqueue(rec(true))).toBe(false); // full
    expect(queue.size()).toBe(2);
    expect(fake.flushCount).toBe(0);
  });

  it('persists exactly the accepted records, with a consistent mutant/human split', async () => {
    const fake = makeFakeSql();
    const queue = createWriteQueue({ sql: fake.sql, config: cfg(), logger: makeSpyLogger() });

    queue.enqueue(rec(true, 'M1'));
    queue.enqueue(rec(false, 'H1'));
    queue.enqueue(rec(true, 'M2'));
    queue.enqueue(rec(false, 'H2'));
    queue.enqueue(rec(false, 'H3'));

    await queue.drain();

    expect(fake.totalPersisted()).toBe(5);
    const totalMutants = fake.flushes.reduce((s, f) => s + f.mutants, 0);
    const totalHumans = fake.flushes.reduce((s, f) => s + f.humans, 0);
    expect(totalMutants).toBe(2);
    expect(totalHumans).toBe(3);
    const dnas = fake.flushes.flatMap((f) => f.rows.map((r) => r.dna));
    expect(dnas.sort()).toEqual(['H1', 'H2', 'H3', 'M1', 'M2']);
  });

  it('drain() flushes whatever remains and stops the timer', async () => {
    const fake = makeFakeSql();
    const logger = makeSpyLogger();
    const queue = createWriteQueue({ sql: fake.sql, config: cfg(), logger });

    queue.enqueue(rec(true));
    queue.enqueue(rec(false));
    expect(queue.size()).toBe(2);

    await queue.drain();

    expect(fake.flushCount).toBe(1);
    expect(fake.totalPersisted()).toBe(2);
    expect(queue.size()).toBe(0);
    expect(logger.info).toHaveBeenCalled();
  });

  it('drops a failed batch (at-most-once) and logs, without spinning', async () => {
    const fake = makeFakeSql();
    const logger = makeSpyLogger();
    const queue = createWriteQueue({ sql: fake.sql, config: cfg(), logger });

    queue.enqueue(rec(true));
    queue.enqueue(rec(false));
    fake.failNextFlush();

    await queue.drain();

    expect(fake.flushCount).toBe(0); // the batch never committed
    expect(fake.totalPersisted()).toBe(0);
    expect(queue.size()).toBe(0); // buffer was drained, records lost
    expect(logger.error).toHaveBeenCalled();
  });

  it('reports the dropped batch tally to onFlushFailure exactly once', async () => {
    // The queue owns no stats, so it hands the dropped mutant/human split back
    // to its caller. That tally is what the server rolls its counters back by,
    // so it has to match the batch precisely.
    const fake = makeFakeSql();
    const onFlushFailure = vi.fn();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg(),
      logger: makeSpyLogger(),
      onFlushFailure,
    });

    queue.enqueue(rec(true, 'M1'));
    queue.enqueue(rec(true, 'M2'));
    queue.enqueue(rec(false, 'H1'));
    fake.failNextFlush();

    await queue.drain();

    expect(onFlushFailure).toHaveBeenCalledTimes(1);
    expect(onFlushFailure).toHaveBeenCalledWith({ mutants: 2, humans: 1 });
    expect(fake.totalPersisted()).toBe(0);
  });

  it('does not call onFlushFailure when every flush succeeds', async () => {
    const fake = makeFakeSql();
    const onFlushFailure = vi.fn();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg(),
      logger: makeSpyLogger(),
      onFlushFailure,
    });

    queue.enqueue(rec(true));
    queue.enqueue(rec(false));
    await queue.drain();

    expect(fake.totalPersisted()).toBe(2);
    expect(onFlushFailure).not.toHaveBeenCalled();
  });

  it('drops safely when built without an onFlushFailure callback', async () => {
    // The callback is optional, so a queue built without one must still drop the
    // batch and log rather than throw on the undefined hook.
    const fake = makeFakeSql();
    const logger = makeSpyLogger();
    const queue = createWriteQueue({ sql: fake.sql, config: cfg(), logger });

    queue.enqueue(rec(true));
    queue.enqueue(rec(false));
    fake.failNextFlush();

    await expect(queue.drain()).resolves.toBeUndefined();

    expect(fake.totalPersisted()).toBe(0);
    expect(queue.size()).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('write queue drain against a dead database', () => {
  // Regression guard. drain() used to walk the buffer batch by batch, so a deep
  // buffer on SIGTERM meant one sql.begin per batch against a database that was
  // already gone, each paying a full connect timeout, and every record dropped
  // anyway. drain() now stops at the first failure and discards the rest.

  /** Fill a queue with an alternating mutant/human split. Returns the tally. */
  function fill(queue: { enqueue(r: WriteRecord): boolean }, count: number) {
    let mutants = 0;
    let humans = 0;
    for (let i = 0; i < count; i += 1) {
      const isMutant = i % 2 === 0;
      if (!queue.enqueue(rec(isMutant, `D${i}`))) break;
      if (isMutant) mutants += 1;
      else humans += 1;
    }
    return { mutants, humans, total: mutants + humans };
  }

  /** Sum every tally handed to onFlushFailure. */
  function reported(spy: ReturnType<typeof vi.fn>) {
    const calls = spy.mock.calls as Array<[{ mutants: number; humans: number }]>;
    return calls.reduce(
      (sum, [t]) => ({ mutants: sum.mutants + t.mutants, humans: sum.humans + t.humans }),
      { mutants: 0, humans: 0 },
    );
  }

  it('stops at the first flush failure instead of attempting every batch', async () => {
    const fake = makeFakeSql();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 10000, batchSize: 500 }),
      logger: makeSpyLogger(),
    });

    fake.failAllFlushes();
    const enqueued = fill(queue, 5000); // ten batches deep
    expect(enqueued.total).toBe(5000);

    await queue.drain();

    // Ten batches buffered, but the database is dead: at most one attempt from
    // the size-triggered flush during enqueue plus one from drain itself. The
    // old batch-by-batch behaviour would show one begin per batch.
    expect(fake.beginAttempts).toBeLessThanOrEqual(2);
    expect(fake.beginAttempts).toBeGreaterThanOrEqual(1);
    expect(fake.flushCount).toBe(0);
  });

  it('discards the whole remaining buffer and reports the full tally, so counters cannot over-report', async () => {
    const fake = makeFakeSql();
    const logger = makeSpyLogger();
    const onFlushFailure = vi.fn();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 10000, batchSize: 500 }),
      logger,
      onFlushFailure,
    });

    fake.failAllFlushes();
    const enqueued = fill(queue, 5000);

    await queue.drain();

    // Every record the route already counted at enqueue time is rolled back:
    // the failed batches via the flush path, the rest via discardBuffer.
    expect(reported(onFlushFailure)).toEqual({ mutants: enqueued.mutants, humans: enqueued.humans });
    expect(queue.size()).toBe(0);
    expect(fake.totalPersisted()).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'flush failed during drain' }),
      'write queue drain gave up: buffered records dropped and counters rolled back',
    );
  });

  it('bounds a hung flush by drainTimeoutMs rather than hanging shutdown', async () => {
    // Real timers with a tiny budget: the deadline is the thing under test, and
    // faking it would only prove the fake advanced.
    const fake = makeFakeSql();
    const logger = makeSpyLogger();
    const onFlushFailure = vi.fn();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 10000, batchSize: 500, drainTimeoutMs: 50 }),
      logger,
      onFlushFailure,
    });

    fake.hangFlushes();
    // 600 records: the first 500 go out in a flush that never settles, leaving
    // 100 buffered behind it for drain to discard once the deadline fires.
    const enqueued = fill(queue, 600);
    expect(queue.size()).toBe(100);

    await expect(queue.drain()).resolves.toBeUndefined();

    expect(queue.size()).toBe(0);
    expect(fake.flushCount).toBe(0);
    // The key property: nothing leaks. The 100 still buffered are rolled back by
    // discardBuffer, and the 500 parked inside the hung transaction by
    // abandonInFlight. That batch had already left the buffer, so without the
    // in-flight handle its counts would survive as a permanent over-report.
    expect(reported(onFlushFailure)).toEqual({ mutants: enqueued.mutants, humans: enqueued.humans });
    expect(reported(onFlushFailure).mutants + reported(onFlushFailure).humans).toBe(600);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'flush failed during drain', dropped: 100 }),
      'write queue drain gave up: buffered records dropped and counters rolled back',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ dropped: 500, rolledBackMutants: 250, rolledBackHumans: 250 }),
      'write queue drain abandoned an in-flight batch: counters rolled back',
    );
  });

  /** Let the abandoned flush's own settlement path run to completion. */
  const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

  it('does not double-report when an abandoned flush later rejects', async () => {
    // The dangerous ordering: drain gives up on a hung flush and rolls its batch
    // back, then the wedged database finally answers with an error and doFlush
    // reaches its own rollback. Both paths hold the same batch, so without the
    // settled flag the counters would be rolled back twice and under-report by a
    // whole batch. Exactly once, no more and no less.
    const fake = makeFakeSql();
    const onFlushFailure = vi.fn();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 10000, batchSize: 500, drainTimeoutMs: 50 }),
      logger: makeSpyLogger(),
      onFlushFailure,
    });

    fake.hangFlushes();
    const enqueued = fill(queue, 600);

    await queue.drain();

    const afterDrain = reported(onFlushFailure);
    expect(afterDrain).toEqual({ mutants: enqueued.mutants, humans: enqueued.humans });

    // The wedged transaction finally answers, long after drain walked away.
    expect(fake.releaseHungFlushes('reject')).toBe(1);
    await settleMicrotasks();

    // Still exactly what was enqueued: the abandoned batch is not reported again.
    expect(reported(onFlushFailure)).toEqual(afterDrain);
    expect(reported(onFlushFailure).mutants + reported(onFlushFailure).humans).toBe(600);
    expect(fake.totalPersisted()).toBe(0);
  });

  it('does not double-report when an abandoned flush later commits', async () => {
    // The other settlement: the hung transaction eventually succeeds, so its rows
    // ARE durable even though drain already rolled the counters back. The queue
    // must not report the batch a second time. The counters now under-report
    // relative to the database, which is the safe direction: a restart re-seeds
    // them from dna_stats.
    const fake = makeFakeSql();
    const onFlushFailure = vi.fn();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 10000, batchSize: 500, drainTimeoutMs: 50 }),
      logger: makeSpyLogger(),
      onFlushFailure,
    });

    fake.hangFlushes();
    const enqueued = fill(queue, 600);

    await queue.drain();
    const afterDrain = reported(onFlushFailure);

    expect(fake.releaseHungFlushes('commit')).toBe(1);
    await settleMicrotasks();

    expect(reported(onFlushFailure)).toEqual(afterDrain);
    expect(reported(onFlushFailure)).toEqual({ mutants: enqueued.mutants, humans: enqueued.humans });
    // The batch committed after the fact, so its rows landed exactly once.
    expect(fake.flushCount).toBe(1);
    expect(fake.totalPersisted()).toBe(500);
  });

  it('hits the drain deadline check when the budget is already spent', async () => {
    const fake = makeFakeSql();
    const logger = makeSpyLogger();
    const onFlushFailure = vi.fn();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 10000, batchSize: 500, drainTimeoutMs: 0 }),
      logger,
      onFlushFailure,
    });

    fake.hangFlushes();
    const enqueued = fill(queue, 400); // below batchSize, so nothing is in flight

    await expect(queue.drain()).resolves.toBeUndefined();

    // A zero budget means the loop discards on its first pass without ever
    // touching the database.
    expect(fake.beginAttempts).toBe(0);
    expect(queue.size()).toBe(0);
    expect(reported(onFlushFailure)).toEqual({ mutants: enqueued.mutants, humans: enqueued.humans });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'drain timeout exceeded', dropped: 400 }),
      'write queue drain gave up: buffered records dropped and counters rolled back',
    );
  });

  it('gives up cleanly when the rollback hook itself throws', async () => {
    // onFlushFailure is caller-supplied, so it can throw and reject the flush
    // pass outright rather than resolving false. Shutdown still has to finish:
    // the deadline race treats a rejected flush exactly like a failed one.
    const fake = makeFakeSql();
    const onFlushFailure = vi.fn().mockImplementationOnce(() => {
      throw new Error('counter rollback boom');
    });
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ batchSize: 500 }),
      logger: makeSpyLogger(),
      onFlushFailure,
    });

    fake.failAllFlushes();
    fill(queue, 400); // below batchSize, so the only flush is drain's own

    await expect(queue.drain()).resolves.toBeUndefined();

    expect(onFlushFailure).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it('a healthy drain still flushes everything from a deep buffer', async () => {
    // The bounded drain must not cut a good shutdown short.
    const fake = makeFakeSql();
    const queue = createWriteQueue({
      sql: fake.sql,
      config: cfg({ queueMaxSize: 10000, batchSize: 500 }),
      logger: makeSpyLogger(),
    });

    const enqueued = fill(queue, 5000);

    await queue.drain();

    expect(fake.totalPersisted()).toBe(5000);
    expect(fake.flushes.reduce((s, f) => s + f.mutants, 0)).toBe(enqueued.mutants);
    expect(fake.flushes.reduce((s, f) => s + f.humans, 0)).toBe(enqueued.humans);
    expect(queue.size()).toBe(0);
  });
});
