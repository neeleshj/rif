'use client';

import type { MutantResult } from '@/lib/api';
import styles from '@/app/console.module.css';

export type ResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: MutantResult };

interface ResultViewProps {
  state: ResultState;
  onRetry: () => void;
}

export function ResultView({ state, onRetry }: ResultViewProps) {
  if (state.status === 'idle') {
    return (
      <p className={styles.resultIdle}>
        No sequence analysed yet. Build a grid and run the detector to see a verdict.
      </p>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className={styles.result} aria-busy="true">
        <div className={styles.verdict}>
          <span className={styles.verdictBadge} aria-hidden>
            <span className={styles.spinner} style={{ borderTopColor: 'var(--accent)' }} />
          </span>
          <div>
            <p className={styles.verdictTitle} style={{ fontSize: '1.15rem' }}>
              Sequencing...
            </p>
            <p className={styles.verdictSub}>Sliding a length-4 window across the grid.</p>
          </div>
        </div>
      </div>
    );
  }

  const { result } = state;

  if (result.kind === 'mutant') {
    return (
      <div className={styles.result} role="status">
        <div className={`${styles.verdict} ${styles.verdictMutant}`}>
          <span className={styles.verdictBadge} aria-hidden>
            ⚠
          </span>
          <div>
            <p className={styles.verdictTitle}>Mutant detected</p>
            <p className={styles.verdictSub}>
              Two or more four-in-a-row sequences were found. The API returned <code>200 OK</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (result.kind === 'human') {
    return (
      <div className={styles.result} role="status">
        <div className={`${styles.verdict} ${styles.verdictHuman}`}>
          <span className={styles.verdictBadge} aria-hidden>
            ✓
          </span>
          <div>
            <p className={styles.verdictTitle}>Not a mutant</p>
            <p className={styles.verdictSub}>
              Fewer than two sequences. Valid human DNA. The API returned <code>403 Forbidden</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (result.kind === 'invalid') {
    return (
      <div className={styles.result} role="alert">
        <div className={`${styles.verdict} ${styles.verdictWarn}`}>
          <span className={styles.verdictBadge} aria-hidden>
            !
          </span>
          <div>
            <p className={styles.verdictTitle}>Invalid DNA</p>
            <p className={styles.verdictSub}>
              Rejected with <code>400 Bad Request</code>.
            </p>
          </div>
        </div>
        <p className={styles.errorDetail}>
          {result.error}: {result.message}
        </p>
      </div>
    );
  }

  // busy (503) or generic error
  return (
    <div className={styles.result} role="alert">
      <div className={`${styles.verdict} ${styles.verdictWarn}`}>
        <span className={styles.verdictBadge} aria-hidden>
          ↻
        </span>
        <div>
          <p className={styles.verdictTitle}>
            {result.kind === 'busy' ? 'Detector busy' : 'Something went wrong'}
          </p>
          <p className={styles.verdictSub}>{result.message}</p>
        </div>
      </div>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <button type="button" className={styles.button} onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}
