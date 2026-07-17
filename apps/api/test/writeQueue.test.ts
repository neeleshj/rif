/**
 * Tests for the write queue: batched flush by size and by interval, backpressure
 * when full, counter/record consistency with what was enqueued, graceful drain
 * on shutdown, and the at-most-once drop path when a flush fails (including the
 * onFlushFailure report the server uses to reconcile its counters).
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

const cfg = (over: Partial<{ queueMaxSize: number; batchSize: number; batchIntervalMs: number }> = {}) => ({
  queueMaxSize: 100,
  batchSize: 500,
  batchIntervalMs: 100000,
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
