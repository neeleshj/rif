import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke tests for the Mutant Detector frontend. The specs stub the
 * same-origin `/api/*` routes with `page.route`, so they exercise the whole UI
 * flow deterministically without a running Fastify backend or database.
 *
 * The webServer block boots the Next.js app on a dedicated port. Run with:
 *   npm run test:e2e -w @rif/web
 * (install browsers first: `npm run test:e2e:install -w @rif/web`).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // npx, not a hardcoded bin path: npm workspaces hoist dependencies to the
    // repo-root node_modules, so apps/web/node_modules/.bin/next does not exist.
    // npx walks up the tree and finds it wherever the install put it.
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
