'use client';

import type { BulkSummary } from '@/lib/bulk';
import styles from '@/app/console.module.css';

interface RandomControlProps {
  size: number;
  onGenerate: (wantMutant: boolean) => void;
  /** Start a bulk run of `bulkCount` random grids against the API. */
  onBulkGenerate: () => void;
  bulkCount: number;
  bulkRunning: boolean;
  /** Submissions settled so far while running, else null. */
  bulkDone: number | null;
  /** Result of the last completed run, else null. */
  bulkSummary: BulkSummary | null;
}

export function RandomControl({
  size,
  onGenerate,
  onBulkGenerate,
  bulkCount,
  bulkRunning,
  bulkDone,
  bulkSummary,
}: RandomControlProps) {
  return (
    <div className={styles.randomBody}>
      <p style={{ margin: 0 }}>
        Fill the current {size} by {size} grid with a random valid sequence: half the time built as a
        mutant, half the time as a human. Force either one to pick the verdict yourself.
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={() => onGenerate(Math.random() < 0.5)}
        >
          Generate sequence
        </button>
        <button type="button" className={styles.button} onClick={() => onGenerate(true)}>
          Force a mutant
        </button>
        <button type="button" className={styles.button} onClick={() => onGenerate(false)}>
          Force a human
        </button>
      </div>

      <hr className={styles.bulkRule} />

      <p style={{ margin: 0 }}>
        Or submit {bulkCount} random {size} by {size} grids in one burst to seed the usage stats and
        exercise the write queue.
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <button
          type="button"
          className={styles.button}
          onClick={onBulkGenerate}
          disabled={bulkRunning}
        >
          {bulkRunning ? (
            <>
              <span className={styles.spinner} aria-hidden /> Generating
            </>
          ) : (
            `Generate ${bulkCount} sequences`
          )}
        </button>
      </div>

      {/* One live region covering both progress and the final summary, so a
          screen reader hears the run start, tick along, and report its result. */}
      <p className={styles.bulkStatus} aria-live="polite" aria-atomic="true">
        {bulkRunning && bulkDone !== null ? `${bulkDone} / ${bulkCount}` : null}
        {!bulkRunning && bulkSummary ? (
          <>
            Done. {bulkSummary.mutant} mutant, {bulkSummary.human} human
            {bulkSummary.busy > 0 ? `, ${bulkSummary.busy} shed as busy (503)` : null}
            {bulkSummary.errors > 0 ? `, ${bulkSummary.errors} failed` : null}.
            {bulkSummary.busy > 0 ? (
              <span className={styles.bulkNote}>
                A 503 means the API shed load because its write queue was full. That is the
                backpressure working as designed, not a failure.
              </span>
            ) : null}
          </>
        ) : null}
      </p>
    </div>
  );
}
