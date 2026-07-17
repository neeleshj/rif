import { describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatsView } from './StatsView';
import { ORIGIN, server } from '../test/msw';

const stats = (fn: Parameters<typeof http.get>[1]) =>
  server.use(http.get(`${ORIGIN}/api/stats`, fn));

describe('StatsView', () => {
  it('renders the fetched counts and ratio', async () => {
    stats(() =>
      HttpResponse.json({ count_mutant_dna: 8, count_human_dna: 5, ratio: 1.6 }),
    );
    render(<StatsView refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('8')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();
    // Ratio is displayed to two decimal places.
    expect(screen.getByText('1.60')).toBeTruthy();
  });

  it('shows a zero ratio when there are no humans', async () => {
    stats(() =>
      HttpResponse.json({ count_mutant_dna: 0, count_human_dna: 0, ratio: 0 }),
    );
    render(<StatsView refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('0.00')).toBeTruthy());
  });

  it('surfaces an error message when stats are unavailable', async () => {
    stats(() => new HttpResponse(null, { status: 502 }));
    render(<StatsView refreshKey={0} />);
    await waitFor(() => expect(screen.getByText(/Stats unavailable \(502\)/i)).toBeTruthy());
  });

  it('re-fetches when the Refresh button is clicked', async () => {
    let calls = 0;
    stats(() => {
      calls += 1;
      return HttpResponse.json({ count_mutant_dna: calls, count_human_dna: 0, ratio: 0 });
    });
    render(<StatsView refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('1')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
  });

  /**
   * Two loads overlap whenever a verification bumps refreshKey while a Refresh is
   * still in flight, and nothing guarantees they resolve in order. The first
   * request is made deliberately slow here so it lands LAST: without sequencing
   * its stale count overwrites the fresh one and the panel lies until the next
   * manual refresh.
   */
  it('ignores a slow first response that resolves after a newer one', async () => {
    let calls = 0;
    stats(async () => {
      calls += 1;
      // Only the first request is slow, so it settles after the second.
      if (calls === 1) {
        await delay(80);
        return HttpResponse.json({ count_mutant_dna: 111, count_human_dna: 0, ratio: 0 });
      }
      return HttpResponse.json({ count_mutant_dna: 222, count_human_dna: 0, ratio: 0 });
    });

    const { rerender } = render(<StatsView refreshKey={0} />);
    rerender(<StatsView refreshKey={1} />);

    await waitFor(() => expect(screen.getByText('222')).toBeTruthy());
    // Let the slow first response land, then confirm it was discarded.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByText('222')).toBeTruthy();
    expect(screen.queryByText('111')).toBeNull();
  });

  /**
   * The other half of the same bug: the superseded request must not re-enable
   * Refresh while a newer one is still running.
   */
  it('keeps Refresh disabled until the newest request settles', async () => {
    let calls = 0;
    stats(async () => {
      calls += 1;
      if (calls === 1) return HttpResponse.json({ count_mutant_dna: 1, count_human_dna: 0, ratio: 0 });
      await delay(80);
      return HttpResponse.json({ count_mutant_dna: 2, count_human_dna: 0, ratio: 0 });
    });

    const { rerender } = render(<StatsView refreshKey={0} />);
    rerender(<StatsView refreshKey={1} />);

    // The first (fast) request settles here, but the second is still in flight.
    await waitFor(() => expect(calls).toBe(2));
    const refresh = screen.getByRole('button', { name: /refreshing|refresh/i }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);

    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
    expect((screen.getByRole('button', { name: /refresh/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
