import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasteInput } from './PasteInput';

const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const loadButton = () => screen.getByRole('button', { name: /load into grid/i });

describe('PasteInput', () => {
  it('parses newline-separated rows and applies them to the grid', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.type(textarea(), 'atgc{Enter}cagt{Enter}ttag{Enter}gcta');
    await userEvent.click(loadButton());
    expect(onApply).toHaveBeenCalledWith(['ATGC', 'CAGT', 'TTAG', 'GCTA']);
    expect(screen.getByText(/Loaded a 4 by 4 grid/i)).toBeTruthy();
  });

  it('parses a JSON array of strings', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    // Paste rather than type: the JSON contains "[" which user-event's type()
    // would interpret as a special key descriptor.
    await userEvent.click(textarea());
    await userEvent.paste('["atgc", "cagt", "ttag", "gcta"]');
    await userEvent.click(loadButton());
    expect(onApply).toHaveBeenCalledWith(['ATGC', 'CAGT', 'TTAG', 'GCTA']);
  });

  it('reports a malformed paste and does not apply', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing to parse/i)).toBeTruthy();
  });

  // One wide row is one row, so the validator rejects it on the lower bound (N is
  // the row count) before width is ever considered. It is still refused, which is
  // what matters here.
  it('rejects a single over-wide row', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.type(textarea(), 'A'.repeat(13));
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was loaded\. Grid too small/i)).toBeTruthy();
  });

  /**
   * The regression: paste validated against MAX_N (the stepper's bound, 12), so a
   * square 16 x 16 grid of valid bases that the API happily accepts could not be
   * entered at all. A stepper bound is not a validity bound. This must load.
   */
  it('loads a valid 16 by 16 grid, which is larger than the stepper maximum', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    const rows = Array.from({ length: 16 }, () => 'ATGC'.repeat(4));
    await userEvent.click(textarea());
    await userEvent.paste(rows.join('\n'));
    await userEvent.click(loadButton());
    expect(onApply).toHaveBeenCalledWith(rows);
    expect(screen.getByText(/Loaded a 16 by 16 grid/i)).toBeTruthy();
  });

  // The client still refuses a grid past the cap the backend enforces, so the two
  // agree rather than the client inventing a stricter rule of its own.
  it('rejects a grid larger than the backend cap', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.click(textarea());
    await userEvent.paste(Array.from({ length: 1001 }, () => 'A'.repeat(1001)).join('\n'));
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was loaded\. Grid too large: N=1001 exceeds 1000/i)).toBeTruthy();
  });

  /**
   * A non-square paste is refused outright. It used to be loaded anyway with a
   * warning, which quietly reshaped it and let the user submit DNA they never
   * entered.
   */
  it('does not apply a non-square paste', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.type(textarea(), 'atgc{Enter}cagta{Enter}ttag{Enter}gcta');
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was loaded\. Grid must be square/i)).toBeTruthy();
  });

  // The exact repro from the report: 4 rows of 6 characters used to load as a
  // 4 x 4 grid with columns 5 and 6 silently dropped.
  it('does not apply the reported 4 by 6 paste', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.click(textarea());
    await userEvent.paste('ATGCGA\nCAGTGC\nTTATGT\nAGAAGG');
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was loaded\. Grid must be square/i)).toBeTruthy();
    expect(screen.queryByText(/Loaded a/i)).toBeNull();
  });

  it('rejects a paste containing a character outside A/T/C/G', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.type(textarea(), 'atgc{Enter}caxt{Enter}ttag{Enter}gcta');
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was loaded\. Invalid character "X"/i)).toBeTruthy();
  });

  // A grid under 4 x 4 cannot hold a four-length run, and the API rejects one as
  // a 400 rather than answering 403, so paste refuses it up front.
  it('rejects a grid with too few rows and does not apply', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.type(textarea(), 'at{Enter}cg');
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was loaded\. Grid too small: N=2/i)).toBeTruthy();
  });

  // 5 rows of 3 characters: N is the row count, so this fails squareness rather
  // than the lower bound.
  it('rejects a grid whose rows are all too short', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.type(textarea(), 'atg{Enter}cag{Enter}tta{Enter}gct{Enter}acg');
    await userEvent.click(loadButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was loaded\. Grid must be square/i)).toBeTruthy();
  });

  it('accepts a grid exactly at the 4 by 4 minimum', async () => {
    const onApply = vi.fn();
    render(<PasteInput onApply={onApply} />);
    await userEvent.type(textarea(), 'atgc{Enter}cagt{Enter}ttag{Enter}gcta');
    await userEvent.click(loadButton());
    expect(onApply).toHaveBeenCalledWith(['ATGC', 'CAGT', 'TTAG', 'GCTA']);
    expect(screen.getByText(/Loaded a 4 by 4 grid/i)).toBeTruthy();
  });

  it('inserts the example sequence', async () => {
    render(<PasteInput onApply={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /insert example/i }));
    expect(textarea().value).toContain('ATGCGA');
  });
});
