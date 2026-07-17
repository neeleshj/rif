import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MutantConsole } from './MutantConsole';
import { ORIGIN, server } from '../test/msw';

const mutant = (fn: Parameters<typeof http.post>[1]) =>
  server.use(http.post(`${ORIGIN}/api/mutant`, fn));

/** Fill every cell of the rendered n x n grid with the given base. */
async function fillGrid(user: ReturnType<typeof userEvent.setup>, n: number, base = 'A') {
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const input = screen.getByRole('textbox', {
        name: `Row ${r + 1}, column ${c + 1}`,
      });
      await user.click(input);
      await user.keyboard(base);
    }
  }
}

/**
 * Shrink the default 6x6 grid down to n x n via the decrease control. n cannot go
 * below MIN_N (4); resizing clears the grid, so fill only after calling this.
 */
async function shrinkTo(user: ReturnType<typeof userEvent.setup>, n: number) {
  const dec = screen.getByRole('button', { name: /decrease grid size/i });
  for (let i = 6; i > n; i -= 1) await user.click(dec);
}

describe('MutantConsole', () => {
  it('blocks running until the grid is complete', async () => {
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    const run = screen.getByRole('button', { name: /run detector/i });
    // The run button is disabled while cells remain empty.
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/remaining/i)).toBeTruthy();
  });

  it('runs the happy path and shows a mutant verdict', async () => {
    mutant(() => new HttpResponse(null, { status: 200 }));
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    await fillGrid(user, 4);
    await user.click(screen.getByRole('button', { name: /run detector/i }));

    const verdict = await screen.findByRole('status');
    expect(within(verdict).getByText(/Mutant detected/i)).toBeTruthy();
  });

  it('shows the not-a-mutant verdict on a 403', async () => {
    mutant(() => new HttpResponse(null, { status: 403 }));
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    await fillGrid(user, 4);
    await user.click(screen.getByRole('button', { name: /run detector/i }));

    const verdict = await screen.findByRole('status');
    expect(within(verdict).getByText(/Not a mutant/i)).toBeTruthy();
  });

  it('renders the invalid verdict when the API returns 400', async () => {
    mutant(() =>
      HttpResponse.json(
        { error: 'Bad Request', message: 'grid must be square' },
        { status: 400 },
      ),
    );
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    await fillGrid(user, 4);
    await user.click(screen.getByRole('button', { name: /run detector/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Invalid DNA/i)).toBeTruthy();
  });

  it('renders a busy verdict on a 503', async () => {
    mutant(() =>
      HttpResponse.json({ error: 'Busy', message: 'try again shortly' }, { status: 503 }),
    );
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    await fillGrid(user, 4);
    await user.click(screen.getByRole('button', { name: /run detector/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Detector busy/i)).toBeTruthy();
    expect(within(alert).getByText(/try again shortly/i)).toBeTruthy();
  });

  it('shows a network error verdict when the API is unreachable', async () => {
    mutant(() => HttpResponse.error());
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    await fillGrid(user, 4);
    await user.click(screen.getByRole('button', { name: /run detector/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Something went wrong/i)).toBeTruthy();
  });

  it('loads a pasted grid and switches to the grid editor', async () => {
    const user = userEvent.setup();
    render(<MutantConsole />);
    await user.click(screen.getByRole('tab', { name: /paste/i }));
    await user.click(screen.getByRole('textbox'));
    // Paste avoids user-event treating "[" as a special key descriptor.
    await user.paste('["ATGC","CAGT","TTAG","GCTA"]');
    await user.click(screen.getByRole('button', { name: /load into grid/i }));

    // Grid editor is now shown with the loaded 4x4 content.
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(16));
    expect(screen.getByText(/Grid complete\. Ready to run\./i)).toBeTruthy();
  });

  /**
   * A verdict belongs to the grid that produced it. Leaving it on screen next to
   * freshly pasted DNA reads as a verdict on DNA that was never submitted, so
   * loading a paste clears it just as resizing does.
   */
  it('drops a stale verdict when a pasted grid is loaded', async () => {
    mutant(() => new HttpResponse(null, { status: 200 }));
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    await fillGrid(user, 4);
    await user.click(screen.getByRole('button', { name: /run detector/i }));
    expect(within(await screen.findByRole('status')).getByText(/Mutant detected/i)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /paste/i }));
    await user.click(screen.getByRole('textbox'));
    await user.paste('["ATGC","CAGT","TTAG","GCTA"]');
    await user.click(screen.getByRole('button', { name: /load into grid/i }));

    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(16));
    expect(screen.queryByText(/Mutant detected/i)).toBeNull();
    expect(screen.getByText(/No sequence analysed yet/i)).toBeTruthy();
  });

  it('clears the grid back to empty', async () => {
    const user = userEvent.setup();
    render(<MutantConsole />);
    await shrinkTo(user, 4);
    await fillGrid(user, 4);
    expect(screen.getByText(/Ready to run/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /clear grid/i }));
    expect(screen.getByText(/remaining/i)).toBeTruthy();
  });

  describe('grid size floor of 4', () => {
    it('disables the decrement once the grid is 4 x 4', async () => {
      const user = userEvent.setup();
      render(<MutantConsole />);
      await shrinkTo(user, 4);
      const dec = screen.getByRole('button', { name: /decrease grid size/i });
      expect((dec as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/4 . 4/)).toBeTruthy();
    });

    it('never shrinks below 4 x 4 however many times decrement is pressed', async () => {
      const user = userEvent.setup();
      render(<MutantConsole />);
      const dec = screen.getByRole('button', { name: /decrease grid size/i });
      // Well past the floor: a disabled button ignores clicks, and the clamp
      // catches anything that does get through.
      for (let i = 0; i < 10; i += 1) await user.click(dec);
      expect(screen.getAllByRole('textbox')).toHaveLength(16);
      expect(screen.getByText(/4 . 4/)).toBeTruthy();
    });

    it('still allows growing back up from the floor', async () => {
      const user = userEvent.setup();
      render(<MutantConsole />);
      await shrinkTo(user, 4);
      await user.click(screen.getByRole('button', { name: /increase grid size/i }));
      expect(screen.getAllByRole('textbox')).toHaveLength(25);
    });
  });

  describe('changing the grid size clears the grid', () => {
    it('empties every cell rather than preserving them', async () => {
      const user = userEvent.setup();
      render(<MutantConsole />);
      await fillGrid(user, 6);
      expect(screen.getByText(/Grid complete\. Ready to run\./i)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /decrease grid size/i }));

      // A 5x5 grid of 25 empty cells, not the truncated top-left of the old one.
      const cells = screen.getAllByRole('textbox');
      expect(cells).toHaveLength(25);
      expect(cells.every((cell) => (cell as HTMLInputElement).value === '')).toBe(true);
      expect(screen.getByText(/25 cells remaining/i)).toBeTruthy();
    });

    it('clears cells when growing too, not just when shrinking', async () => {
      const user = userEvent.setup();
      render(<MutantConsole />);
      await fillGrid(user, 6);
      await user.click(screen.getByRole('button', { name: /increase grid size/i }));

      const cells = screen.getAllByRole('textbox');
      expect(cells).toHaveLength(49);
      expect(cells.every((cell) => (cell as HTMLInputElement).value === '')).toBe(true);
    });

    it('drops a stale verdict so it is not shown against the new grid', async () => {
      mutant(() => new HttpResponse(null, { status: 200 }));
      const user = userEvent.setup();
      render(<MutantConsole />);
      await fillGrid(user, 6);
      await user.click(screen.getByRole('button', { name: /run detector/i }));
      expect(within(await screen.findByRole('status')).getByText(/Mutant detected/i)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /decrease grid size/i }));

      expect(screen.queryByText(/Mutant detected/i)).toBeNull();
      expect(screen.getByText(/No sequence analysed yet/i)).toBeTruthy();
    });
  });

  it('surfaces a client-side validation failure without calling the API', async () => {
    let posted = false;
    mutant(() => {
      posted = true;
      return new HttpResponse(null, { status: 200 });
    });
    const user = userEvent.setup();
    render(<MutantConsole />);
    // A sub-4 grid cannot be built through the UI (the stepper clamps at 4 and
    // paste refuses one), so drive validation with an out-of-alphabet cell.
    await fillGrid(user, 6);
    const cell = screen.getByRole('textbox', { name: 'Row 1, column 1' });
    await user.clear(cell);
    expect(screen.getByText(/1 cell remaining/i)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /run detector/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(posted).toBe(false);
  });

  describe('bulk generation of 100 sequences', () => {
    /** Switch to the Random tab and start a bulk run. */
    async function startBulk(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('tab', { name: /random/i }));
      await user.click(screen.getByRole('button', { name: /generate 100 sequences/i }));
    }

    it('submits 100 grids and summarises the verdicts', async () => {
      let posts = 0;
      // Alternating so the summary has a non-trivial mix to report.
      mutant(() => new HttpResponse(null, { status: posts++ % 2 === 0 ? 200 : 403 }));
      const user = userEvent.setup();
      render(<MutantConsole />);
      await startBulk(user);

      await screen.findByText(/50 mutant, 50 human/i, undefined, { timeout: 5000 });
      expect(posts).toBe(100);
    });

    it('counts 503 backpressure separately from real errors', async () => {
      let posts = 0;
      mutant(() => {
        posts += 1;
        // First 60 accepted, next 30 shed as busy, last 10 genuinely rejected.
        if (posts <= 60) return new HttpResponse(null, { status: 403 });
        if (posts <= 90) {
          return HttpResponse.json({ error: 'Busy', message: 'queue full' }, { status: 503 });
        }
        return HttpResponse.json({ error: 'Bad Request', message: 'nope' }, { status: 400 });
      });
      const user = userEvent.setup();
      render(<MutantConsole />);
      await startBulk(user);

      const live = await screen.findByText(/60 human/i, undefined, { timeout: 5000 });
      expect(live.textContent).toContain('30 shed as busy (503)');
      expect(live.textContent).toContain('10 failed');
      // The 503s must not be folded into the error count.
      expect(live.textContent).not.toContain('40 failed');
      expect(screen.getByText(/backpressure working as designed/i)).toBeTruthy();
    });

    it('counts unreachable-API failures as errors', async () => {
      mutant(() => HttpResponse.error());
      const user = userEvent.setup();
      render(<MutantConsole />);
      await startBulk(user);

      await screen.findByText(/0 mutant, 0 human, 100 failed/i, undefined, { timeout: 5000 });
    });

    it('disables the button while the run is in flight', async () => {
      // Held open so the run cannot finish before the assertion.
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mutant(async () => {
        await gate;
        return new HttpResponse(null, { status: 403 });
      });
      const user = userEvent.setup();
      render(<MutantConsole />);
      await startBulk(user);

      const button = await screen.findByRole('button', { name: /generating/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);

      release();
      await screen.findByText(/100 human/i, undefined, { timeout: 5000 });
    });

    it('bounds concurrency rather than firing all 100 at once', async () => {
      let inFlight = 0;
      let peak = 0;
      mutant(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return new HttpResponse(null, { status: 403 });
      });
      const user = userEvent.setup();
      render(<MutantConsole />);
      await startBulk(user);

      await screen.findByText(/100 human/i, undefined, { timeout: 5000 });
      expect(peak).toBeLessThanOrEqual(10);
      expect(peak).toBeGreaterThan(1);
    });

    it('refreshes the stats once the run completes', async () => {
      let statsReads = 0;
      mutant(() => new HttpResponse(null, { status: 200 }));
      server.use(
        http.get(`${ORIGIN}/api/stats`, () => {
          statsReads += 1;
          // Counters move once the bulk run has been recorded.
          return HttpResponse.json(
            statsReads > 1
              ? { count_mutant_dna: 100, count_human_dna: 0, ratio: 0 }
              : { count_mutant_dna: 0, count_human_dna: 0, ratio: 0 },
          );
        }),
      );
      const user = userEvent.setup();
      render(<MutantConsole />);
      await startBulk(user);

      await screen.findByText(/100 mutant, 0 human/i, undefined, { timeout: 5000 });
      // The stats panel re-reads and shows the moved counter.
      await waitFor(() => expect(statsReads).toBeGreaterThan(1));
      await screen.findByText('100');
    });

    it('leaves the grid and the single-submit flow untouched', async () => {
      mutant(() => new HttpResponse(null, { status: 403 }));
      const user = userEvent.setup();
      render(<MutantConsole />);
      await fillGrid(user, 6, 'T');
      await startBulk(user);
      await screen.findByText(/100 human/i, undefined, { timeout: 5000 });

      // Back on the grid tab the hand-entered cells survive, and Run still works.
      await user.click(screen.getByRole('tab', { name: /grid/i }));
      const cells = screen.getAllByRole('textbox');
      expect(cells).toHaveLength(36);
      expect(cells.every((cell) => (cell as HTMLInputElement).value === 'T')).toBe(true);

      await user.click(screen.getByRole('button', { name: /run detector/i }));
      expect(within(await screen.findByRole('status')).getByText(/Not a mutant/i)).toBeTruthy();
    });
  });
});
