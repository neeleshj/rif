import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from './page';

describe('Page', () => {
  it('renders the heading, intro and the console', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: /Mutant/i })).toBeTruthy();
    // The console's input panel is present.
    expect(screen.getByRole('heading', { level: 2, name: /DNA input/i })).toBeTruthy();
    // Status-contract footer note.
    expect(screen.getByText(/proxied same-origin/i)).toBeTruthy();
  });
});
