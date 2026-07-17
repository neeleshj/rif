/**
 * Tests for GET /metrics, driven through Fastify's .inject() with an injected
 * fake Postgres client (see helpers.ts). No real database or socket is involved.
 *
 * Covers: the endpoint returns 200 with a Prometheus text content type and the
 * expected metric names, request traffic is reflected in the counters, the
 * mutant/human split plus the queue-depth / buffer-fill gauges track real state,
 * and the load-shed 503 is counted apart from genuine faults.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import type { BuiltServer } from '../src/index.js';
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

describe('GET /metrics', () => {
  it('returns 200 with a Prometheus text content type and the expected names', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);

    const body = res.body;
    for (const name of [
      'rif_requests_total',
      'rif_mutant_total',
      'rif_human_total',
      'rif_errors_total',
      'rif_load_shed_total',
      'rif_request_duration_seconds',
      'rif_queue_depth',
      'rif_buffer_fill_ratio',
    ]) {
      expect(body).toContain(name);
    }
    // A HELP line is emitted for each metric, confirming it is registered.
    expect(body).toContain('# HELP rif_request_duration_seconds');
    expect(body).toContain('# TYPE rif_request_duration_seconds histogram');
  });

  it('counts requests by route and status and observes the latency histogram', async () => {
    const { app } = build();
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;

    // requests_total is labelled with the matched route pattern and status.
    expect(body).toMatch(/rif_requests_total\{route="\/mutant\/",status="200"\}\s+1/);
    expect(body).toMatch(/rif_requests_total\{route="\/mutant\/",status="403"\}\s+1/);
    // The latency histogram recorded observations for the write route.
    expect(body).toMatch(/rif_request_duration_seconds_count\{route="\/mutant\/"\}\s+2/);
  });

  it('splits mutant and human totals from the write-path status contract', async () => {
    const { app } = build();
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;

    expect(body).toMatch(/^rif_mutant_total\s+1$/m);
    expect(body).toMatch(/^rif_human_total\s+2$/m);
  });

  it('reports live queue depth and buffer fill from the write queue', async () => {
    // queueMaxSize 4 with a large batchSize so nothing auto-flushes: two
    // accepted writes leave depth 2 and fill 0.5.
    const { app } = build({ queueMaxSize: 4, batchSize: 1000 });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: NON_MUTANT } });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;

    expect(body).toMatch(/^rif_queue_depth\s+2$/m);
    expect(body).toMatch(/^rif_buffer_fill_ratio\s+0\.5$/m);
  });

  it('increments errors_total on a 5xx response', async () => {
    const { app } = build();
    app.get('/boom', async () => {
      throw new Error('kaboom');
    });
    await app.inject({ method: 'GET', url: '/boom' });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(/^rif_errors_total\s+1$/m);
    // A genuine fault is not shed load.
    expect(res.body).toMatch(/^rif_load_shed_total\s+0$/m);
  });

  it('counts a write-queue 503 as shed load, not as an error', async () => {
    // queueMaxSize 1 with a large batchSize: the first write fills the buffer
    // and the next two are shed. Backpressure is the system working, so it must
    // stay out of rif_errors_total or every error-rate alert fires precisely
    // when the service is correctly protecting itself.
    const { app } = build({ queueMaxSize: 1, batchSize: 1000 });

    const first = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
    expect(first.statusCode).toBe(200);
    for (const _ of [0, 1]) {
      const shed = await app.inject({ method: 'POST', url: '/mutant/', payload: { dna: MUTANT } });
      expect(shed.statusCode).toBe(503);
    }

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;

    expect(body).toMatch(/^rif_load_shed_total\s+2$/m);
    expect(body).toMatch(/^rif_errors_total\s+0$/m);
    // The shed responses are still visible in the labelled request total.
    expect(body).toMatch(/rif_requests_total\{route="\/mutant\/",status="503"\}\s+2/);
  });

  it('counts a 503 from /health as an error, not as shed load', async () => {
    // The split is by route, not by status code: an unreachable database is a
    // real fault that happens to answer 503, and it must still alert.
    const { app, fake } = build();
    fake.failSelects();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(503);

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;

    expect(body).toMatch(/^rif_errors_total\s+1$/m);
    expect(body).toMatch(/^rif_load_shed_total\s+0$/m);
  });
});
