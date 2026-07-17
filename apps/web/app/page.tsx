import { MutantConsole } from './MutantConsole';
import styles from './console.module.css';

export default function Page() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.kicker}>Rent It Furnished · Technical Test 2026</span>
        <div className={styles.brandRow}>
          <span className={styles.mark} aria-hidden>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6 3c0 4.5 12 6 12 9s-12 4.5-12 9" />
              <path d="M18 3c0 4.5-12 6-12 9s12 4.5 12 9" />
              <path d="M7.5 6h9M8.5 9h7M8.5 15h7M7.5 18h9" />
            </svg>
          </span>
          <h1 className={styles.wordmark}>
            Mutant <em>Detector</em>
          </h1>
        </div>
        <p className={styles.lede}>
          Enter an <code>N &times; N</code> DNA grid of the four bases. A human is a mutant when the
          grid holds more than one run of four identical letters in a line, checked horizontally,
          vertically, or diagonally. The browser validates for fast feedback; the Fastify API is the
          source of truth.
        </p>
      </header>

      <MutantConsole />

      <footer className={styles.footer}>
        <span>
          Status contract: <code>200</code> mutant · <code>403</code> not mutant · <code>400</code>{' '}
          invalid · <code>503</code> busy
        </span>
        <span>Requests are proxied same-origin through Next.js to the backend.</span>
      </footer>
    </main>
  );
}
