import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Component tests via React Testing Library + happy-dom, with MSW mocking /api.
// See PLAN.md Phase 5 and the README Testing section.
export default defineConfig({
  // esbuild handles the automatic JSX runtime so .tsx components render without
  // pulling in an extra React plugin dependency.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      // Mirror the Next.js "@/*" path alias so imports resolve under Vitest.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/native-globals.ts', './test/setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    // Playwright specs live under e2e/ and are run by Playwright, not Vitest.
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['app/**', 'components/**', 'lib/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'app/layout.tsx'],
      // The spec asks for >80% coverage. Reporting it is not enforcing it: without
      // thresholds the suite stays green all the way down to 60%. These fail the
      // run instead, and they sit just under the current actuals rather than at
      // the 80% floor, so a real regression trips them long before the bar does.
      thresholds: {
        statements: 98,
        branches: 96,
        functions: 96,
        lines: 98,
      },
    },
  },
});
