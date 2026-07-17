/**
 * In-memory stats counters. Loaded from dna_stats on boot (so restart is O(1),
 * not a COUNT(*) scan) and incremented at enqueue time, so GET /stats/ is an
 * O(1) read of local RAM that never touches the database.
 *
 * These are deliberately separate from the durable dna_stats row: the write
 * queue updates the database once per batch, while these track every accepted
 * request for the read path. Both converge, per the eventual-consistency
 * trade documented in the dev log.
 */

import type { Sql } from 'postgres';

export interface CounterSnapshot {
  countMutant: number;
  countHuman: number;
  updatedAt: Date;
}

interface StatsRow {
  count_mutant: string;
  count_human: string;
  updated_at: Date;
}

export class Counters {
  private countMutant = 0;
  private countHuman = 0;
  private updatedAt = new Date(0);

  /** Seed the counters from the persisted dna_stats row. */
  async load(sql: Sql): Promise<void> {
    const rows = await sql<StatsRow[]>`
      SELECT count_mutant, count_human, updated_at
      FROM dna_stats
      WHERE id = true
    `;
    const row = rows[0];
    if (row) {
      this.countMutant = Number(row.count_mutant);
      this.countHuman = Number(row.count_human);
      this.updatedAt = new Date(row.updated_at);
    }
  }

  /** Count one accepted verification. Bumps updatedAt for the Last-Modified header. */
  increment(isMutant: boolean): void {
    if (isMutant) {
      this.countMutant += 1;
    } else {
      this.countHuman += 1;
    }
    this.updatedAt = new Date();
  }

  /**
   * Undo counts for records that were accepted but never made it to disk (a
   * flush transaction that failed and dropped its batch). Without this the
   * in-memory counters would over-report until the next restart re-seeded them
   * from dna_stats, at which point the numbers would visibly decrease.
   *
   * Clamped at zero so a rollback can never drive a counter negative.
   */
  rollback(mutants: number, humans: number): void {
    this.countMutant = Math.max(0, this.countMutant - mutants);
    this.countHuman = Math.max(0, this.countHuman - humans);
    this.updatedAt = new Date();
  }

  /** O(1) snapshot for the stats route. */
  read(): CounterSnapshot {
    return {
      countMutant: this.countMutant,
      countHuman: this.countHuman,
      updatedAt: this.updatedAt,
    };
  }
}
