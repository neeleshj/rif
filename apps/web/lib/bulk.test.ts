import { describe, expect, it, vi } from 'vitest';
import { runBulk } from './bulk';
import type { MutantResult } from './api';

const resolved = (kind: MutantResult['kind']) => async (): Promise<MutantResult> =>
  ({ kind, error: 'Bad Request', message: 'nope' }) as MutantResult;

describe('runBulk', () => {
  it('submits exactly `count` grids', async () => {
    const submit = vi.fn(resolved('human'));
    const summary = await runBulk({ count: 25, concurrency: 4, size: 4, submit });
    expect(submit).toHaveBeenCalledTimes(25);
    expect(summary.human).toBe(25);
  });

  it('submits square grids of the requested size, all valid bases', async () => {
    const seen: string[][] = [];
    await runBulk({
      count: 3,
      concurrency: 2,
      size: 5,
      submit: async (dna) => {
        seen.push(dna);
        return { kind: 'human' };
      },
    });
    expect(seen).toHaveLength(3);
    for (const dna of seen) {
      expect(dna).toHaveLength(5);
      expect(dna.every((row) => /^[ATCG]{5}$/.test(row))).toBe(true);
    }
  });

  it('tallies each response kind, counting 503 busy apart from errors', async () => {
    const kinds: MutantResult['kind'][] = [
      'mutant',
      'mutant',
      'human',
      'busy',
      'busy',
      'busy',
      'invalid',
      'error',
    ];
    let i = 0;
    const summary = await runBulk({
      count: kinds.length,
      // Serial, so the responses are consumed in the order listed above.
      concurrency: 1,
      size: 4,
      submit: async () => ({ kind: kinds[i++]!, error: 'Bad Request', message: 'x' }) as MutantResult,
    });
    expect(summary).toEqual({ mutant: 2, human: 1, busy: 3, errors: 2 });
  });

  it('counts a 503 as busy rather than an error', async () => {
    const summary = await runBulk({
      count: 6,
      concurrency: 3,
      size: 4,
      submit: async () => ({ kind: 'busy', message: 'Detector busy.' }),
    });
    expect(summary.busy).toBe(6);
    expect(summary.errors).toBe(0);
  });

  it('tallies a thrown submission as an error without abandoning the run', async () => {
    let n = 0;
    const summary = await runBulk({
      count: 4,
      concurrency: 1,
      size: 4,
      submit: async () => {
        n += 1;
        if (n === 2) throw new Error('socket hang up');
        return { kind: 'mutant' };
      },
    });
    expect(summary).toEqual({ mutant: 3, human: 0, busy: 0, errors: 1 });
  });

  it('reports progress once per settled submission, ending at count', async () => {
    const progress: number[] = [];
    await runBulk({
      count: 10,
      concurrency: 3,
      size: 4,
      submit: resolved('human'),
      onProgress: (done) => progress.push(done),
    });
    expect(progress).toHaveLength(10);
    // Each worker increments a shared counter, so the sequence is monotonic.
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('never exceeds the concurrency limit of in-flight submissions', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk({
      count: 50,
      concurrency: 8,
      size: 4,
      submit: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return { kind: 'human' };
      },
    });
    expect(peak).toBeLessThanOrEqual(8);
    // Guards against a serial regression: the pool must actually run in parallel.
    expect(peak).toBeGreaterThan(1);
  });

  it('does not spawn more workers than there is work', async () => {
    let peak = 0;
    let inFlight = 0;
    await runBulk({
      count: 2,
      concurrency: 10,
      size: 4,
      submit: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return { kind: 'human' };
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('honours the injected mutant bias', async () => {
    const wantMutant = vi.fn(() => true);
    await runBulk({ count: 5, concurrency: 2, size: 4, submit: resolved('human'), wantMutant });
    expect(wantMutant).toHaveBeenCalledTimes(5);
  });
});
