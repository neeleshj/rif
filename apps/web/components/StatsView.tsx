'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchStats, type StatsResult } from '@/lib/api';
import styles from '@/app/console.module.css';

interface StatsViewProps {
  /** Increment to trigger a refresh (e.g. after a successful verification). */
  refreshKey: number;
}

export function StatsView({ refreshKey }: StatsViewProps) {
  const [state, setState] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchStats();
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
