import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
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
});
