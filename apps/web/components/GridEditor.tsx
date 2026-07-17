'use client';

import { useRef } from 'react';
import { MAX_N, MIN_N } from '@/lib/constants';
import { isBase, type Cell, type Grid } from '@/lib/grid';
import styles from '@/app/console.module.css';

interface GridEditorProps {
  grid: Grid;
  size: number;
  onCellChange: (r: number, c: number, value: Cell) => void;
  onSizeChange: (n: number) => void;
}

function cellClass(value: Cell): string {
  // `value` is typed as a base, but paste can introduce an out-of-alphabet
  // character at runtime; flag those so they are visible before submission.
  const v = value as string;
  switch (v) {
    case '':
      return '';
    case 'A':
      return styles.cellA!;
    case 'T':
      return styles.cellT!;
    case 'C':
      return styles.cellC!;
    case 'G':
      return styles.cellG!;
    default:
      return styles.cellInvalid!;
  }
}

export function GridEditor({ grid, size, onCellChange, onSizeChange }: GridEditorProps) {
  // 2D ref grid so cells can move focus to their neighbours.
  const refs = useRef<(HTMLInputElement | null)[][]>([]);
  refs.current = grid.map((row, r) => row.map((_, c) => refs.current[r]?.[c] ?? null));

  const focusCell = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    refs.current[r]?.[c]?.focus();
    refs.current[r]?.[c]?.select();
  };

  const handleChange = (r: number, c: number, raw: string) => {
    const ch = raw.slice(-1).toUpperCase();
    if (ch === '') {
      onCellChange(r, c, '');
      return;
    }
    if (isBase(ch)) {
      onCellChange(r, c, ch);
      // Auto-advance for fast sequential entry.
      const next = c + 1 < size ? [r, c + 1] : r + 1 < size ? [r + 1, 0] : null;
      if (next) focusCell(next[0]!, next[1]!);
    }
    // Non-base characters are ignored, giving immediate "only ATCG" feedback.
  };

  const handleKeyDown = (r: number, c: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusCell(r, c + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusCell(r, c - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusCell(r + 1, c);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusCell(r - 1, c);
        break;
      case 'Backspace':
        if (grid[r]?.[c] === '') {
          e.preventDefault();
          focusCell(c > 0 ? r : r - 1, c > 0 ? c - 1 : size - 1);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div>
      <div className={styles.sizeRow}>
        <div className={styles.sizeControl}>
          <label id="grid-size-label" htmlFor="grid-size-dec">
            Grid size
          </label>
          <div className={styles.stepper} role="group" aria-labelledby="grid-size-label">
            <button
              id="grid-size-dec"
              type="button"
              className={styles.stepBtn}
              onClick={() => onSizeChange(size - 1)}
              disabled={size <= MIN_N}
              aria-label="Decrease grid size"
            >
              &minus;
            </button>
            <span className={styles.stepValue} aria-live="polite">
              {size} &times; {size}
            </span>
            <button
              type="button"
              className={styles.stepBtn}
              onClick={() => onSizeChange(size + 1)}
              disabled={size >= MAX_N}
              aria-label="Increase grid size"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className={styles.gridScroll}>
        <div
          className={styles.grid}
          role="group"
          aria-label={`DNA grid, ${size} by ${size}`}
          style={{ gridTemplateColumns: `repeat(${size}, minmax(30px, 46px))` }}
        >
          {grid.map((row, r) =>
            row.map((cell, c) => (
              <input
                // eslint-disable-next-line react/no-array-index-key
                key={`${r}-${c}`}
                ref={(el) => {
                  if (!refs.current[r]) refs.current[r] = [];
                  refs.current[r]![c] = el;
                }}
                className={`${styles.cell} ${cellClass(cell)}`}
                value={cell}
                onChange={(e) => handleChange(r, c, e.target.value)}
                onKeyDown={(e) => handleKeyDown(r, c, e)}
                onFocus={(e) => e.target.select()}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={1}
                aria-label={`Row ${r + 1}, column ${c + 1}`}
                placeholder="."
              />
            )),
          )}
        </div>
      </div>

      <ul className={styles.legend} aria-label="Base colour legend">
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--base-a)' }} /> A · adenine
        </li>
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--base-t)' }} /> T · thymine
        </li>
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--base-c)' }} /> C · cytosine
        </li>
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--base-g)' }} /> G · guanine
        </li>
      </ul>
    </div>
  );
}
