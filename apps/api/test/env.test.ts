/**
 * Unit tests for the repo-root .env loader.
 *
 * The bug these guard: npm runs workspace scripts with cwd set to apps/api, so
 * dotenv's default cwd lookup never finds the root file. rootEnvPath() resolves
 * the path from the module's own URL instead, which must land on the repo root
 * from both src (tsx) and dist.
 *
 * These tests never assume a .env actually exists: the file is gitignored, so it
 * is present for a developer and absent in a clean checkout. Only the resolved
 * path and the no-override behaviour are asserted.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRootEnv, rootEnvPath } from '../src/env.js';

// Derived from this test file's own URL rather than hardcoded, so the suite is
// not tied to one machine's checkout location. This file sits at
// apps/api/test/env.test.ts, the same depth as the apps/api/src/env.ts it
// covers, so the expected root is three levels up.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');

describe('rootEnvPath', () => {
  it('returns an absolute path to a file named .env', () => {
    const path = rootEnvPath();
    expect(isAbsolute(path)).toBe(true);
    expect(path.endsWith('/.env')).toBe(true);
  });

  it('points at the repo root, not the api workspace', () => {
    expect(dirname(rootEnvPath())).toBe(REPO_ROOT);
    expect(dirname(rootEnvPath())).not.toMatch(/apps\/api/);
  });

  // Anchors the assertion above to real landmarks. If someone changes the number
  // of ../ segments in env.ts, the directory stops being the workspace root and
  // this fails even if REPO_ROOT drifted the same way.
  it('resolves to the directory that holds schema.sql and the root package.json', () => {
    const root = dirname(rootEnvPath());
    expect(existsSync(`${root}/schema.sql`)).toBe(true);

    const pkg: unknown = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
    expect(pkg).toMatchObject({ workspaces: expect.any(Array) });
  });
});

describe('loadRootEnv', () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    // Vitest isolates each test file, but restore anyway so ordering within this
    // file cannot matter.
    process.env = { ...snapshot };
  });

  it('does not throw, whether or not the file is there', () => {
    expect(() => loadRootEnv()).not.toThrow();
  });

  it('keeps a real environment variable over any file value', () => {
    const sentinel = 'postgres://sentinel/not-from-the-file';
    process.env.DATABASE_URL = sentinel;

    loadRootEnv();

    expect(process.env.DATABASE_URL).toBe(sentinel);
  });
});
