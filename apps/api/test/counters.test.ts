/**
 * Unit tests for the in-memory Counters (boot-load, increment, rollback of a
 * dropped batch, O(1) read) and a smoke test that createClient returns a usable
 * client without connecting.
 */

import { describe, expect, it } from 'vitest';
import { Counters } from '../src/stats/counters.js';
import { createClient } from '../src/db/client.js';
import { makeFakeSql } from './helpers.js';

describe('Counters', () => {
  it('starts at zero with an epoch updatedAt', () => {
    const snap = new Counters().read();
    expect(snap.countMutant).toBe(0);
    expect(snap.countHuman).toBe(0);
    expect(snap.updatedAt.getTime()).toBe(0);
  });

  it('loads the persisted dna_stats row on boot (coercing bigint strings)', async () => {
    const updated = new Date('2026-01-01T00:00:00.000Z');
    const fake = makeFakeSql([{ count_mutant: '7', count_human: '3', updated_at: updated }]);
    const counters = new Counters();
    await counters.load(fake.sql);
    const snap = counters.read();
    expect(snap.countMutant).toBe(7);
    expect(snap.countHuman).toBe(3);
    expect(snap.updatedAt.getTime()).toBe(updated.getTime());
  });

  it('leaves counters untouched when no dna_stats row exists', async () => {
    const fake = makeFakeSql([]);
    const counters = new Counters();
    await counters.load(fake.sql);
    expect(counters.read()).toMatchObject({ countMutant: 0, countHuman: 0 });
  });

  it('increment bumps the right counter and advances updatedAt', () => {
    const counters = new Counters();
    counters.increment(true);
    counters.increment(false);
    counters.increment(false);
    const snap = counters.read();
    expect(snap.countMutant).toBe(1);
    expect(snap.countHuman).toBe(2);
    expect(snap.updatedAt.getTime()).toBeGreaterThan(0);
  });

  it('rollback subtracts a dropped batch from both counters', () => {
    // Five mutants and three humans were counted at enqueue time; a batch of
    // two mutants and one human then failed to flush and was dropped.
    const counters = new Counters();
    for (let i = 0; i < 5; i += 1) counters.increment(true);
    for (let i = 0; i < 3; i += 1) counters.increment(false);

    counters.rollback(2, 1);

    const snap = counters.read();
    expect(snap.countMutant).toBe(3);
    expect(snap.countHuman).toBe(2);
    expect(snap.updatedAt.getTime()).toBeGreaterThan(0);
  });

  it('rollback clamps at zero rather than going negative', () => {
    // A rollback larger than what is counted must floor at zero: a negative
    // count would be nonsense in the stats body and would poison the ratio.
    const counters = new Counters();
    counters.increment(true);

    counters.rollback(10, 10);

    expect(counters.read()).toMatchObject({ countMutant: 0, countHuman: 0 });
  });

  it('rollback of an all-zero tally leaves the counts alone', () => {
    const counters = new Counters();
    counters.increment(true);
    counters.increment(false);

    counters.rollback(0, 0);

    expect(counters.read()).toMatchObject({ countMutant: 1, countHuman: 1 });
  });
});

describe('createClient', () => {
  it('returns a callable client without opening a connection', () => {
    const sql = createClient('postgres://user:pass@localhost:5432/db');
    expect(typeof sql).toBe('function');
    // Close the lazily-created pool so the test leaves nothing open.
    return sql.end({ timeout: 1 });
  });
});
