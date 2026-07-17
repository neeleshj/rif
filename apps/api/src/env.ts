/**
 * Loads the single repo-root `.env` into process.env.
 *
 * npm runs workspace scripts with cwd set to `apps/api`, so dotenv's default
 * cwd lookup would never find the root file. The path is therefore resolved
 * from this module's own URL, which keeps it correct whether the code runs from
 * `src` under tsx or from the built `dist` (both sit one level under apps/api).
 *
 * Call this from an entry point before loadConfig(). It is deliberately not a
 * module-level side effect, so importing the server in a test never reaches for
 * the developer's .env.
 */

import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/** Absolute path to the repo-root .env, resolved from this module. */
export function rootEnvPath(): string {
  // apps/api/src/env.ts (or apps/api/dist/env.js) -> repo root is three up.
  return fileURLToPath(new URL('../../../.env', import.meta.url));
}

/**
 * Populate process.env from the repo-root .env. Real environment variables win
 * over file values, so CI and shell overrides keep working. A missing file is
 * not an error: the environment may be configured entirely outside the file.
 */
export function loadRootEnv(): void {
  loadDotenv({ path: rootEnvPath() });
}
