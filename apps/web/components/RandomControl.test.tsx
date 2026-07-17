import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RandomControl } from './RandomControl';

const defaults = {
  size: 6,
  onGenerate: () => {},
  onBulkGenerate: () => {},
  bulkCount: 100,
  bulkRunning: false,
  bulkDone: null,
  bulkSummary: null,
};

describe('RandomControl', () => {
  it('shows the current grid size in its description', () => {
    render(<RandomControl {...defaults} size={5} />);
    expect(screen.getByText(/Fill the current 5 by 5 grid/i)).toBeTruthy();
  });

  it('describes the bulk run at the current grid size', () => {
    render(<RandomControl {...defaults} size={5} />);
    expect(screen.getByText(/submit 100 random 5 by 5 grids/i)).toBeTruthy();
  });

  it('requests a mutant when "Force a mutant" is clicked', async () => {
    const onGenerate = vi.fn();
    render(<RandomControl {...defaults} onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole('button', { name: /force a mutant/i }));
    expect(onGenerate).toHaveBeenCalledWith(true);
  });

  it('requests a human when "Force a human" is clicked', async () => {
    const onGenerate = vi.fn();
    render(<RandomControl {...defaults} onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole('button', { name: /force a human/i }));
    expect(onGenerate).toHaveBeenCalledWith(false);
  });

  it('generates a valid grid on "Generate sequence"', async () => {
    const onGenerate = vi.fn();
    render(<RandomControl {...defaults} onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole('button', { name: /generate sequence/i }));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(typeof onGenerate.mock.calls[0]![0]).toBe('boolean');
  });

  describe('bulk generation', () => {
    it('starts a bulk run when the button is clicked', async () => {
      const onBulkGenerate = vi.fn();
      render(<RandomControl {...defaults} onBulkGenerate={onBulkGenerate} />);
      await userEvent.click(screen.getByRole('button', { name: /generate 100 sequences/i }));
      expect(onBulkGenerate).toHaveBeenCalledOnce();
    });

    it('disables the button and shows progress while running', () => {
      render(<RandomControl {...defaults} bulkRunning bulkDone={42} />);
      expect(screen.getByRole('button', { name: /generating/i }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByText('42 / 100')).toBeTruthy();
    });

    it('announces progress in a live region', () => {
      const { container } = render(<RandomControl {...defaults} bulkRunning bulkDone={7} />);
      const live = container.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toContain('7 / 100');
    });

    it('summarises mutant and human counts on completion', () => {
      render(
        <RandomControl
          {...defaults}
          bulkSummary={{ mutant: 61, human: 39, busy: 0, errors: 0 }}
        />,
      );
      expect(screen.getByText(/61 mutant, 39 human/i)).toBeTruthy();
    });

    it('reports shed 503s separately and explains they are expected', () => {
      render(
        <RandomControl
          {...defaults}
          bulkSummary={{ mutant: 50, human: 30, busy: 20, errors: 0 }}
        />,
      );
      expect(screen.getByText(/20 shed as busy \(503\)/i)).toBeTruthy();
      expect(screen.getByText(/backpressure working as designed, not a failure/i)).toBeTruthy();
    });

    it('reports real errors apart from 503s', () => {
      render(
        <RandomControl
          {...defaults}
          bulkSummary={{ mutant: 40, human: 40, busy: 15, errors: 5 }}
        />,
      );
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toContain('15 shed as busy (503)');
      expect(live?.textContent).toContain('5 failed');
    });

    it('omits the busy and error clauses when a run is clean', () => {
      render(
        <RandomControl {...defaults} bulkSummary={{ mutant: 55, human: 45, busy: 0, errors: 0 }} />,
      );
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent).not.toContain('503');
      expect(live?.textContent).not.toContain('failed');
    });

    it('shows no progress or summary before a run has started', () => {
      const { container } = render(<RandomControl {...defaults} />);
      expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
      expect(
        screen.getByRole('button', { name: /generate 100 sequences/i }).hasAttribute('disabled'),
      ).toBe(false);
    });
  });
});
