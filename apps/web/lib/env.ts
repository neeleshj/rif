/**
 * Environment parsing for the Next.js route handlers.
 *
 * The API validates the same variables in `apps/api/src/config.ts` and stays the
 * authority. This deliberately mirrors that parser rather than inventing a
 * stricter one: the two must read a given value the same way, or the proxy and
 * the backend would disagree about the cap they are both enforcing.
 *
 * What it fixes: the proxy used to take `Number(process.env.MAX_GRID_SIZE)` at
 * face value. A typo like `1000n` yields NaN, every comparison against NaN is
 * false, and the fast-reject silently disappeared.
 */

type Env = Record<string, string | undefined>;

/**
 * Read a positive integer from the environment, falling back when it is unset.
 * Throws on a value that is present but not a positive integer, so a
 * misconfigured process fails loudly at module load instead of degrading.
 */
export function parseIntEnv(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer, got "${raw}"`);
  }
  return value;
}
