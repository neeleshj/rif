'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStats, type StatsResult } from '@/lib/api';
import styles from '@/app/console.module.css';

interface StatsViewProps {
  /** Increment to trigger a refresh (e.g. after a successful verification). */
  refreshKey: number;
}

export function StatsView({ refreshKey }: StatsViewProps) {
  const [state, setState] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Sequence number of the most recently STARTED request. Two loads can overlap
   * (a verification bumps refreshKey while a manual Refresh is in flight) and
   * nothing makes them resolve in order, so without this the older response can
   * land last and leave the panel showing stale counts until the next refresh.
   * A ref, not state: it must be readable synchronously and must not re-render.
   */
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = (latest.current += 1);
    setLoading(true);
    const result = await fetchStats();
    // A superseded request has nothing useful to say: not its result, and not
    // "loading finished" either, since a newer one is still running and Refresh
    // must stay disabled until IT settles.
    if (id !== latest.current) return;
    setState(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const stats = state?.ok ? state.stats : null;

  return (
    <div>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats ? stats.count_mutant_dna : '·'}</div>
          <div className={styles.statLabel}>Mutant</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats ? stats.count_human_dna : '·'}</div>
          <div className={styles.statLabel}>Human</div>
        </div>
        <div className={styles.statCard}>
          <div className={`${styles.statValue} ${styles.statValueAccent}`}>
            {stats ? stats.ratio.toFixed(2) : '·'}
          </div>
          <div className={styles.statLabel}>Ratio</div>
        </div>
      </div>

      <div className={styles.statMeta}>
        <span aria-live="polite">
          {state && !state.ok ? state.message : 'Total verifications recorded by the API.'}
        </span>
        <button type="button" className={styles.linkBtn} onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
