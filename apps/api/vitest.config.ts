import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Backend test config (PLAN.md Phase 3). Node environment, v8 coverage.
//
// Note on database isolation: the dev log's chosen approach for real
// integration tests is a dedicated local test database with transaction
// rollback or truncate between runs. This environment has no Postgres, so the
// data layer is instead mocked through the same dependency injection the server
// already exposes (buildServer(config, sql) and createWriteQueue({ sql, ... })).
// The fake sql lives in test/helpers.ts. See its header for details.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/**/*.ts'],
      // db/setup.ts is a one-shot CLI that connects to a live database to apply
      // schema.sql; it has no unit surface and is excluded from coverage.
      exclude: ['src/db/setup.ts'],
      all: true,
      // The spec asks for >80% coverage, so the suite must FAIL below the bar
      // rather than merely report it. These sit just under the current actuals
      // (about 94/97/95/94), which leaves room for honest churn while keeping
      // real headroom over the 80% floor: coverage cannot silently rot back to
      // the minimum. Raise them as coverage improves; do not lower them to make
      // a red run go green.
      thresholds: {
        statements: 92,
        branches: 95,
        functions: 92,
        lines: 92,
      },
    },
  },
});
