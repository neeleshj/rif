'use client';

import { useMemo, useState } from 'react';
import { normaliseDna, validateDna } from '@rif/shared';
import { submitMutant } from '@/lib/api';
import { runBulk, type BulkSummary } from '@/lib/bulk';
import { BULK_CONCURRENCY, BULK_COUNT, DEFAULT_N, MAX_N, MAX_UI_GRID, MIN_N } from '@/lib/constants';
import {
  createGrid,
  emptyCount,
  gridToDna,
  isGridComplete,
  randomGrid,
  rowsToGrid,
  setCell,
  type Cell,
  type Grid,
} from '@/lib/grid';
import { GridEditor } from '@/components/GridEditor';
import { PasteInput } from '@/components/PasteInput';
import { RandomControl } from '@/components/RandomControl';
import { ResultView, type ResultState } from '@/components/ResultView';
import { StatsView } from '@/components/StatsView';
import styles from './console.module.css';

type Mode = 'grid' | 'paste' | 'random';

const MODES: { id: Mode; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'paste', label: 'Paste' },
  { id: 'random', label: 'Random' },
];

const clampSize = (n: number) => Math.max(MIN_N, Math.min(MAX_N, n));

type BulkState =
  | { status: 'idle' }
  | { status: 'running'; done: number }
  | { status: 'done'; summary: BulkSummary };

export function MutantConsole() {
  const [mode, setMode] = useState<Mode>('grid');
  const [size, setSize] = useState(DEFAULT_N);
  const [grid, setGrid] = useState<Grid>(() => createGrid(DEFAULT_N));
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statsRefresh, setStatsRefresh] = useState(0);
  const [bulk, setBulk] = useState<BulkState>({ status: 'idle' });

  const remaining = useMemo(() => emptyCount(grid), [grid]);
  const complete = remaining === 0;

  /**
   * Changing N starts a fresh grid rather than preserving or truncating the old
   * cells, which used to leave a confusing half-filled grid behind. Any verdict
   * on screen belonged to the previous grid, so it is cleared too.
   */
  const changeSize = (n: number) => {
    const next = clampSize(n);
    setGrid(createGrid(next));
    setSize(next);
    setResult({ status: 'idle' });
    setSubmitError(null);
  };

  const changeCell = (r: number, c: number, value: Cell) => {
    setGrid((g) => setCell(g, r, c, value));
    setSubmitError(null);
  };

  /**
   * Loading a pasted grid clears the verdict for the same reason `changeSize`
   * does: it belonged to the grid that was just replaced, and leaving it up next
   * to freshly pasted DNA reads as a verdict on DNA that was never submitted.
   */
  const applyRows = (rows: string[]) => {
    setGrid(rowsToGrid(rows));
    setSize(rows.length);
    setResult({ status: 'idle' });
    setSubmitError(null);
    setMode('grid');
  };

  const generate = (wantMutant: boolean) => {
    setGrid(randomGrid(size, wantMutant));
    setResult({ status: 'idle' });
    setSubmitError(null);
    setMode('grid');
  };

  /**
   * Seed the system with a burst of random grids so the stats counters move
   * visibly. Deliberately separate from `run`: it drives the API directly and
   * never touches the grid or the verdict, so the single-submit flow is
   * unaffected by a bulk run.
   */
  const generateBulk = async () => {
    setBulk({ status: 'running', done: 0 });
    setSubmitError(null);
    const summary = await runBulk({
      count: BULK_COUNT,
      concurrency: BULK_CONCURRENCY,
      size,
      submit: submitMutant,
      onProgress: (done) => setBulk({ status: 'running', done }),
    });
    setBulk({ status: 'done', summary });
    setStatsRefresh((n) => n + 1);
  };

  const run = async () => {
    if (!isGridComplete(grid)) {
      setSubmitError(`Fill every cell first: ${remaining} remaining.`);
      return;
    }
    const dna = normaliseDna(gridToDna(grid));
    const check = validateDna(dna, MAX_UI_GRID);
    if (!check.valid) {
      setSubmitError(check.message);
      return;
    }

    setSubmitError(null);
    setResult({ status: 'loading' });
    const outcome = await submitMutant(check.dna);
    setResult({ status: 'done', result: outcome });
    if (outcome.kind === 'mutant' || outcome.kind === 'human') {
      setStatsRefresh((n) => n + 1);
    }
  };

  const statusText = submitError ?? (complete ? 'Grid complete. Ready to run.' : `${remaining} cell${remaining === 1 ? '' : 's'} remaining.`);
  const statusClass = submitError
    ? styles.statusWarn
    : complete
      ? styles.statusOk
      : undefined;

  return (
    <div className={styles.layout}>
      <section className={styles.panel} aria-labelledby="input-heading">
        <div className={styles.panelHead}>
          <h2 id="input-heading" className={styles.panelTitle}>
            DNA input
          </h2>
          <div className={styles.tabs} role="tablist" aria-label="Input mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`${styles.tab} ${mode === m.id ? styles.tabActive : ''}`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'grid' && (
          <GridEditor grid={grid} size={size} onCellChange={changeCell} onSizeChange={changeSize} />
        )}
        {mode === 'paste' && <PasteInput onApply={applyRows} />}
        {mode === 'random' && (
          <RandomControl
            size={size}
            onGenerate={generate}
            onBulkGenerate={() => void generateBulk()}
            bulkCount={BULK_COUNT}
            bulkRunning={bulk.status === 'running'}
            bulkDone={bulk.status === 'running' ? bulk.done : null}
            bulkSummary={bulk.status === 'done' ? bulk.summary : null}
          />
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() => void run()}
            disabled={result.status === 'loading' || !complete}
          >
            {result.status === 'loading' ? (
              <>
                <span className={styles.spinner} aria-hidden /> Running
              </>
            ) : (
              'Run detector'
            )}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setGrid(createGrid(size));
              setResult({ status: 'idle' });
              setSubmitError(null);
            }}
          >
            Clear grid
          </button>
        </div>

        <p className={`${styles.status} ${statusClass ?? ''}`} aria-live="polite">
          <span className={styles.dot} />
          {statusText}
        </p>
      </section>

      <div className={styles.stack}>
        <section className={styles.panel} aria-labelledby="result-heading">
          <div className={styles.panelHead}>
            <h2 id="result-heading" className={styles.panelTitle}>
              Verdict
            </h2>
          </div>
          <ResultView state={result} onRetry={() => void run()} />
        </section>

        <section className={styles.panel} aria-labelledby="stats-heading">
          <div className={styles.panelHead}>
            <h2 id="stats-heading" className={styles.panelTitle}>
              Usage stats
            </h2>
            <span className={styles.panelHint}>GET /stats/</span>
          </div>
          <StatsView refreshKey={statsRefresh} />
        </section>
      </div>
    </div>
  );
}
