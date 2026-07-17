'use client';

import { useState } from 'react';
import { validateDna } from '@rif/shared';
import { MAX_N } from '@/lib/constants';
import { parsePaste } from '@/lib/grid';
import styles from '@/app/console.module.css';

interface PasteInputProps {
  onApply: (rows: string[]) => void;
}

const EXAMPLE = 'ATGCGA\nCAGTGC\nTTATGT\nAGAAGG\nCCCCTA\nTCACTG';

/** Make a lower-case validator message read as a sentence of its own. */
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

export function PasteInput({ onApply }: PasteInputProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ kind: 'warn' | 'ok'; text: string } | null>(null);

  const apply = () => {
    const parsed = parsePaste(text);
    if (!parsed.ok) {
      setMessage({ kind: 'warn', text: parsed.error });
      return;
    }
    // The shared validator is the source of truth for the rules the API applies:
    // square, N x N, only A/T/C/G, and N within bounds. MAX_N is passed as the
    // upper bound because the editor cannot render anything larger.
    //
    // A rejected paste is not applied at all. It used to be loaded anyway with a
    // warning, which meant a 4 by 6 paste silently became a 4 by 4 grid the user
    // never typed and could then submit for a verdict.
    const check = validateDna(parsed.rows, MAX_N);
    if (!check.valid) {
      setMessage({ kind: 'warn', text: `Nothing was loaded. ${sentence(check.message)}` });
      return;
    }

    const n = check.dna.length;
    onApply(check.dna);
    setMessage({ kind: 'ok', text: `Loaded a ${n} by ${n} grid.` });
  };

  return (
    <div>
      <label htmlFor="paste-area" className={styles.srOnly}>
        Paste DNA rows or a JSON array
      </label>
      <textarea
        id="paste-area"
        className={styles.textarea}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (message) setMessage(null);
        }}
        placeholder={`Paste newline-separated rows\n${EXAMPLE}\n\n...or a JSON array\n["ATGCGA", "CAGTGC", ...]`}
        spellCheck={false}
        autoCapitalize="characters"
      />
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={apply}>
          Load into grid
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setText(EXAMPLE);
            setMessage(null);
          }}
        >
          Insert example
        </button>
      </div>
      {message ? (
        <p className={`${styles.status} ${message.kind === 'warn' ? styles.statusWarn : styles.statusOk}`}>
          <span className={styles.dot} />
          {message.text}
        </p>
      ) : (
        <p className={styles.helpText}>
          Accepts newline-separated rows or a JSON array of strings. Everything is uppercased.
        </p>
      )}
    </div>
  );
}
