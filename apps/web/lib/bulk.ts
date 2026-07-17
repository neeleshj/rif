/**
 * Bulk submission of randomly generated grids, used to seed the system so
 * `/stats/` shows meaningful numbers and to demonstrate throughput.
 *
 * Kept free of React (like `grid.ts`) so the concurrency behaviour can be tested
 * directly. Work is run through a fixed pool of workers rather than one big
 * `Promise.all`: firing all 100 at once would open 100 sockets and is the fastest
 * way to trip the API's own backpressure, while a serial loop wastes the whole
 * point of the demo. A small pool keeps the queue busy without stampeding it.
 */

import type { MutantResult } from '@/lib/api';
import { gridToDna, randomGrid } from '@/lib/grid';

export interface BulkSummary {
  /** Verified as mutant (API 200). */
  mutant: number;
  /** Verified as human (API 403). */
  human: number;
  /**
   * Shed by the write queue (API 503). Counted apart from `errors` because
   * backpressure is the system working as designed under load, not a fault.
   */
  busy: number;
  /** Genuine failures: rejected payloads (400), transport errors, anything else. */
  errors: number;
}

export interface BulkOptions {
  /** How many grids to generate and submit. */
  count: number;
  /** Maximum submissions in flight at once. */
  concurrency: number;
  /** Edge length of each generated grid. */
  size: number;
  /** Submit one payload. Injected so tests can drive it without the network. */
  submit: (dna: string[]) => Promise<MutantResult>;
  /** Called after each settled submission with the number completed so far. */
  onProgress?: (done: number) => void;
  /** Decides the random generator's mutant bias per grid. Injectable for tests. */
  wantMutant?: () => boolean;
}

const emptySummary = (): BulkSummary => ({ mutant: 0, human: 0, busy: 0, errors: 0 });

function tally(summary: BulkSummary, result: MutantResult): void {
  switch (result.kind) {
    case 'mutant':
      summary.mutant += 1;
      break;
    case 'human':
      summary.human += 1;
      break;
    case 'busy':
      summary.busy += 1;
      break;
    default:
      // 'invalid' (400) and 'error' are both real problems worth surfacing.
      summary.errors += 1;
      break;
  }
}

/**
 * Generate and submit `count` random grids with at most `concurrency` in flight,
 * reporting progress as each settles. Never rejects: a thrown submission is
 * tallied as an error so one failure cannot abandon the run.
 */
export async function runBulk({
  count,
  concurrency,
  size,
  submit,
  onProgress,
  wantMutant = () => Math.random() < 0.5,
}: BulkOptions): Promise<BulkSummary> {
  const summary = emptySummary();
  let started = 0;
  let done = 0;

  // Each worker pulls the next index until the run is exhausted, so a slow
  // submission never blocks the others behind it.
  const worker = async (): Promise<void> => {
    while (started < count) {
      started += 1;
      const dna = gridToDna(randomGrid(size, wantMutant()));
      try {
        tally(summary, await submit(dna));
      } catch {
        summary.errors += 1;
      }
      done += 1;
      onProgress?.(done);
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, count)) }, worker);
  await Promise.all(workers);
  return summary;
}
