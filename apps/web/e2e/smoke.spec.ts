import { expect, test, type Page } from '@playwright/test';

/**
 * Whole-flow smoke tests. The backend is stubbed at the same-origin `/api/*`
 * boundary so these run without Fastify or Postgres. They are for confidence
 * in the wiring, not for coverage.
 */

const VALID_GRID = ['ATGCGA', 'CAGTGC', 'TTATGT', 'AGAAGG', 'CCCCTA', 'TCACTG'];

/** Stub the stats endpoint so the stats panel resolves on load. */
async function stubStats(page: Page) {
  await page.route('**/api/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count_mutant_dna: 1, count_human_dna: 1, ratio: 1 }),
    }),
  );
}

/** Load a full grid through the Paste tab. */
async function pasteGrid(page: Page, rows: string[]) {
  await page.getByRole('tab', { name: /paste/i }).click();
  await page.getByRole('textbox').fill(JSON.stringify(rows));
  await page.getByRole('button', { name: /load into grid/i }).click();
}

test('happy path: fill a grid, submit, and see a mutant verdict', async ({ page }) => {
  await stubStats(page);
  await page.route('**/api/mutant', (route) => route.fulfill({ status: 200 }));

  await page.goto('/');
  await pasteGrid(page, VALID_GRID);
  await expect(page.getByText(/Grid complete\. Ready to run\./i)).toBeVisible();

  await page.getByRole('button', { name: /run detector/i }).click();
  await expect(page.getByText(/Mutant detected/i)).toBeVisible();
});

test('a non-mutant grid shows the human verdict', async ({ page }) => {
  await stubStats(page);
  await page.route('**/api/mutant', (route) => route.fulfill({ status: 403 }));

  await page.goto('/');
  await pasteGrid(page, VALID_GRID);
  await page.getByRole('button', { name: /run detector/i }).click();
  await expect(page.getByText(/Not a mutant/i)).toBeVisible();
});

test('validation-error path: an incomplete grid cannot be submitted', async ({ page }) => {
  await stubStats(page);
  await page.goto('/');

  // The default grid is empty, so the run control is disabled and the status
  // line reports the remaining cells.
  const run = page.getByRole('button', { name: /run detector/i });
  await expect(run).toBeDisabled();
  await expect(page.getByText(/cells remaining/i)).toBeVisible();
});

test('a backend 400 surfaces an invalid-DNA verdict', async ({ page }) => {
  await stubStats(page);
  await page.route('**/api/mutant', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Bad Request', message: 'grid must be square' }),
    }),
  );

  await page.goto('/');
  await pasteGrid(page, VALID_GRID);
  await page.getByRole('button', { name: /run detector/i }).click();
  await expect(page.getByText(/Invalid DNA/i)).toBeVisible();
});
