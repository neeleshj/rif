import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultView, type ResultState } from './ResultView';
import type { MutantResult } from '@/lib/api';

const done = (result: MutantResult): ResultState => ({ status: 'done', result });

describe('ResultView', () => {
  it('renders the idle prompt before any run', () => {
    render(<ResultView state={{ status: 'idle' }} onRetry={() => {}} />);
    expect(screen.getByText(/No sequence analysed yet/i)).toBeTruthy();
  });

  it('renders a busy/loading state', () => {
    const { container } = render(<ResultView state={{ status: 'loading' }} onRetry={() => {}} />);
    expect(screen.getByText(/Sequencing/i)).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('renders the mutant verdict', () => {
    render(<ResultView state={done({ kind: 'mutant' })} onRetry={() => {}} />);
    expect(screen.getByText(/Mutant detected/i)).toBeTruthy();
    expect(screen.getByText(/200 OK/i)).toBeTruthy();
  });

  it('renders the not-a-mutant verdict', () => {
    render(<ResultView state={done({ kind: 'human' })} onRetry={() => {}} />);
    expect(screen.getByText(/Not a mutant/i)).toBeTruthy();
    expect(screen.getByText(/403 Forbidden/i)).toBeTruthy();
  });

  it('renders an invalid verdict with the error detail', () => {
    render(
      <ResultView
        state={done({ kind: 'invalid', error: 'Bad Request', message: 'grid must be square' })}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Invalid DNA/i)).toBeTruthy();
    expect(screen.getByText(/grid must be square/i)).toBeTruthy();
  });

  it('renders the busy (503) verdict with a working retry button', async () => {
    const onRetry = vi.fn();
    render(<ResultView state={done({ kind: 'busy', message: 'try later' })} onRetry={onRetry} />);
    expect(screen.getByText(/Detector busy/i)).toBeTruthy();
    expect(screen.getByText(/try later/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders a generic error verdict', () => {
    render(
      <ResultView state={done({ kind: 'error', message: 'Could not reach the detector.' })} onRetry={() => {}} />,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
    expect(screen.getByText(/Could not reach the detector/i)).toBeTruthy();
  });
});
