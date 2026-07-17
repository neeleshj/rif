/**
 * Integration tests for the HTTP routes, driven through Fastify's .inject() with
 * an injected fake Postgres client (see helpers.ts). No real database or open
 * socket is involved.
 *
 * Covers the error contract (200 mutant / 403 fewer than two sequences / 400
 * malformed, including a sub-4 grid / 503 queue full), that a record is enqueued
 * on 200 and 403 but never on 400, that every outcome carries an explanatory
 * message, the stats shape and ratio (including ratio: 0 with no humans), the
 * dependency-checking health probe on both the ok and the database-down path,
 * and the counter reconcile after a dropped flush.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import type { BuiltServer } from '../src/index.js';
import { registerHealthRoute } from '../src/routes/health.js';
import { makeConfig, makeFakeSql } from './helpers.js';
import type { FakeSql } from './helpers.js';
import type { Config } from '../src/config.js';

const MUTANT = ['ATGCGA', 'CAGTGC', 'TTATGT', 'AGAAGG', 'CCCCTA', 'TCACTG'];
const NON_MUTANT = ['ATGCGA', 'CAGTGC', 'TTATTT', 'AGACGG', 'GCGTCA', 'TCACTG'];

const open: FastifyInstance[] = [];

function build(overrides: Partial<Config> = {}): BuiltServer & { fake: FakeSql } {
  const fake = makeFakeSql();
  const built = buildServer(makeConfig(overrides), fake.sql);
  open.push(built.app);
  return { ...built, fake };
}

afterEach(async () => {
  while (open.length > 0) {
    const app = open.pop();
    if (app) await app.close();
  }
});

describe('GET /health', () => {
  it('returns 200 and reports the database check when the query succeeds', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('returns 503, not a 500, when the database is unreachable', async () => {
    const { app, fake } = build();
    fake.failSelects();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { database: 'error' } });
  });

  it('returns 503 rather than hanging when the database does not answer', async () => {
    // A wedged database: the query never settles. The probe must still answer,
    // bounded by its timeout, so a hung DB cannot hang the load balancer probe.
    const fake = makeFakeSql();
    fake.hangSelects();
    const app = Fastify({ logger: false });
    open.push(app);
    registerHealthRoute(app, { sql: fake.sql, timeoutMs: 10 });

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { database: 'error' } });
  });
});

describe('POST /mutant/', () => {
  it('returns 200 for a mutant and enqueues the record', async () => {
    const { app, queue, counters } = build();
    const res = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isMutant: true });
    expect(res.json().message).toMatch(/mutant detected/i);
    expect(queue.size()).toBe(1);
    expect(counters.read().countMutant).toBe(1);
  });

  it('returns 403 for a valid non-mutant and still enqueues the record', async () => {
    const { app, queue, counters } = build();
    const res = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ isMutant: false });
    // The 403 explains itself: evaluated, but fewer than two sequences found.
    expect(res.json().message).toMatch(/fewer than two sequences/i);
    expect(queue.size()).toBe(1);
    expect(counters.read().countHuman).toBe(1);
  });

  it('distinguishes the 403 message from the sub-4 grid message', async () => {
    // The point of the message field: these two outcomes used to be
    // indistinguishable in the body. They must not read the same now.
    const { app } = build();
    const human = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    const tiny = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: ['AT', 'GC'] } });
    expect(human.json().message).not.toEqual(tiny.json().message);
  });

  it('normalises lowercase input before checking', async () => {
    const { app } = build();
    const res = await app.inject({
      method: 'POST',
      url: '/mutant/',
      payload: { dna: MUTANT.map((row) => row.toLowerCase()) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isMutant: true });
  });

  it('returns 400 for a grid smaller than 4x4 and persists nothing', async () => {
    // N<4 cannot contain a sequence of four, so it is not evaluable and is a
    // client error, not a 403 "not a mutant". Nothing is written or counted,
    // keeping unevaluable inputs out of the stats.
    const { app, queue, counters } = build();
    const res = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: ['AT', 'GC'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request' });
    expect(res.json().message).toMatch(/too small|at least 4/i);
    expect(queue.size()).toBe(0);
    expect(counters.read()).toMatchObject({ countMutant: 0, countHuman: 0 });
  });

  it('accepts a 4x4 grid, the smallest evaluable size', async () => {
    const { app } = build();
    const res = await app.inject({
      method: 'POST',
      url: '/mutant/',
      payload: { dna: ['ATGC', 'CGTA', 'TACG', 'GCAT'] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/fewer than two sequences/i);
  });

  it('resolves without the trailing slash too', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'POST', url: '/mutant', payload: { dna: MUTANT } });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 with an { error, message } body for an invalid character', async () => {
    const { app, queue, counters } = build();
    const res = await app.inject({
      method: 'POST',
      url: '/mutant/',
      payload: { dna: ['ATGX', 'CGTA', 'TACG', 'GCAT'] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('message');
    expect(body.message).toMatch(/invalid character/i);
    // Nothing enqueued or counted on a 400.
    expect(queue.size()).toBe(0);
    expect(counters.read()).toMatchObject({ countMutant: 0, countHuman: 0 });
  });

  it('returns 400 for a non-square grid', async () => {
    const { app, queue } = build();
    const res = await app.inject({
      method: 'POST',
      url: '/mutant/',
      // N=4 so the size gate passes and the squareness gate is what rejects it.
      payload: { dna: ['ATGC', 'CG', 'TACG', 'GCAT'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/square/i);
    expect(queue.size()).toBe(0);
  });

  it('returns 400 via schema when the body shape is wrong', async () => {
    const { app, queue } = build();
    const missing = await app.inject({ method: 'POST', url: '/mutant/', payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'bad_request' });

    const wrongType = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: 'ATGC' } });
    expect(wrongType.statusCode).toBe(400);

    const extraProp = await app.inject({
      method: 'POST',
      url: '/mutant/',
      payload: { dna: ['ATGC'], sneaky: true },
    });
    expect(extraProp.statusCode).toBe(400);

    expect(queue.size()).toBe(0);
  });

  it('returns 503 and sheds load when the write queue is full', async () => {
    // queueMaxSize 1 with a large batchSize: the first request fills the buffer,
    // the second is rejected before it is counted or persisted.
    const { app, queue, counters } = build({ queueMaxSize: 1, batchSize: 1000 });

    const first = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    expect(second.statusCode).toBe(503);
    expect(second.json()).toMatchObject({ error: 'unavailable' });

    // The rejected request left the counters and buffer untouched.
    expect(queue.size()).toBe(1);
    expect(counters.read().countMutant).toBe(1);
  });
});

describe('error handling and logging', () => {
  it('maps an unhandled error to a 500 with the internal_error body', async () => {
    const { app } = build();
    // A test-only route that throws a non-validation error exercises the
    // server's 500 branch in setErrorHandler.
    app.get('/boom', async () => {
      throw new Error('kaboom');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error', message: 'internal server error' });
  });

  it('samples successful requests when logSampleRate is 1', async () => {
    // Drives the success branch of the onResponse sampling hook.
    const { app } = build({ logSampleRate: 1 });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /stats/', () => {
  it('returns the three-field shape with ratio 0 when there are no humans', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'GET', url: '/stats/' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count_mutant_dna: 0, count_human_dna: 0, ratio: 0 });
    expect(res.headers['cache-control']).toBe('max-age=1');
    expect(res.headers['last-modified']).toBeDefined();
  });

  it('keeps ratio 0 when there are mutants but no humans', async () => {
    const { app } = build();
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    const res = await app.inject({ method: 'GET', url: '/stats/' });
    expect(res.json()).toEqual({ count_mutant_dna: 1, count_human_dna: 0, ratio: 0 });
  });

  it('reflects the counts and ratio of accepted verifications', async () => {
    const { app } = build();
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });

    const res = await app.inject({ method: 'GET', url: '/stats/' });
    // 2 mutants, 4 humans -> ratio 0.5.
    expect(res.json()).toEqual({ count_mutant_dna: 2, count_human_dna: 4, ratio: 0.5 });
  });
});

describe('stats reconcile after a dropped flush', () => {
  it('does not over-report once a failed flush drops the batch', async () => {
    // The load-bearing test for the enqueue-time counting trade. The route
    // counts before Postgres is touched, so a flush that fails and drops its
    // batch would leave /stats/ reporting verifications that never reached
    // disk, and the numbers would visibly drop on the next restart when the
    // counters reseeded from dna_stats. onFlushFailure -> Counters.rollback is
    // what keeps the reported counts from drifting above what is durable.
    const { app, queue, counters, fake } = build();

    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });

    // Counted at enqueue time, before anything is durable.
    const before = await app.inject({ method: 'GET', url: '/stats/' });
    expect(before.json()).toEqual({ count_mutant_dna: 1, count_human_dna: 2, ratio: 0.5 });
    expect(fake.totalPersisted()).toBe(0);

    fake.failNextFlush();
    await queue.drain();

    // Nothing committed, so the whole batch is gone.
    expect(fake.flushCount).toBe(0);
    expect(fake.totalPersisted()).toBe(0);

    // The reported counts now match what is actually persisted: zero.
    const after = await app.inject({ method: 'GET', url: '/stats/' });
    expect(after.json()).toEqual({ count_mutant_dna: 0, count_human_dna: 0, ratio: 0 });
    expect(counters.read()).toMatchObject({ countMutant: 0, countHuman: 0 });
  });

  it('rolls back only the dropped batch and keeps the flushed one counted', async () => {
    // batchSize 2: the first pair flushes and commits, the second pair is
    // dropped. Only the dropped tally comes off the counters.
    const { app, queue, fake } = build({ batchSize: 2 });

    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    await vi.waitFor(() => expect(fake.flushCount).toBe(1));

    // Arm the failure before the pair completes: reaching batchSize kicks the
    // flush off from inside enqueue, so setting it afterwards would race.
    fake.failNextFlush();
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await queue.drain();

    // Two records durable (1 mutant, 1 human); the second batch of two mutants
    // never committed and was rolled back off the counters.
    expect(fake.totalPersisted()).toBe(2);
    const res = await app.inject({ method: 'GET', url: '/stats/' });
    expect(res.json()).toEqual({ count_mutant_dna: 1, count_human_dna: 1, ratio: 1 });
  });
});
