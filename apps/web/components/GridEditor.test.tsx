import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GridEditor } from './GridEditor';
import { MAX_N } from '@/lib/constants';
import { createGrid, gridToDna, setCell, type Cell, type Grid } from '@/lib/grid';

/** Controlled harness mirroring how MutantConsole drives the editor. */
function Harness({
  n = 2,
  onSizeChange = () => {},
}: {
  n?: number;
  onSizeChange?: (n: number) => void;
}) {
  const [grid, setGrid] = useState<Grid>(() => createGrid(n));
  return (
    <GridEditor
      grid={grid}
      size={n}
      onCellChange={(r, c, value) => setGrid((g) => setCell(g, r, c, value))}
      onSizeChange={onSizeChange}
    />
  );
}

const cell = (r: number, c: number) =>
  screen.getByRole('textbox', { name: `Row ${r + 1}, column ${c + 1}` }) as HTMLInputElement;

describe('GridEditor', () => {
  it('accepts A/T/C/G and uppercases input', async () => {
    render(<Harness n={2} />);
    await userEvent.click(cell(0, 0));
    await userEvent.keyboard('a');
    expect(cell(0, 0).value).toBe('A');
  });

  it('ignores characters outside the alphabet', async () => {
    render(<Harness n={2} />);
    await userEvent.click(cell(0, 0));
    await userEvent.keyboard('x');
    expect(cell(0, 0).value).toBe('');
    await userEvent.keyboard('9');
    expect(cell(0, 0).value).toBe('');
  });

  it('auto-advances focus to the next cell after a valid base', async () => {
    render(<Harness n={2} />);
    await userEvent.click(cell(0, 0));
    await userEvent.keyboard('t');
    expect(cell(0, 0).value).toBe('T');
    // Focus should have moved to the next cell in the row.
    expect(document.activeElement).toBe(cell(0, 1));
  });

  it('fills a full row via sequential typing', async () => {
    render(<Harness n={2} />);
    await userEvent.click(cell(0, 0));
    await userEvent.keyboard('atcg');
    // Two cells in row 0, then two in row 1.
    const dna = gridToDna([
      [cell(0, 0).value as Cell, cell(0, 1).value as Cell],
      [cell(1, 0).value as Cell, cell(1, 1).value as Cell],
    ]);
    expect(dna).toEqual(['AT', 'CG']);
  });

  it('renders an n x n grid of inputs', () => {
    render(<Harness n={3} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(9);
  });

  it('requests a larger grid via the increase control', async () => {
    const onSizeChange = vi.fn();
    render(<Harness n={4} onSizeChange={onSizeChange} />);
    await userEvent.click(screen.getByRole('button', { name: /increase grid size/i }));
    expect(onSizeChange).toHaveBeenCalledWith(5);
  });

  it('requests a smaller grid via the decrease control', async () => {
    const onSizeChange = vi.fn();
    render(<Harness n={5} onSizeChange={onSizeChange} />);
    await userEvent.click(screen.getByRole('button', { name: /decrease grid size/i }));
    expect(onSizeChange).toHaveBeenCalledWith(4);
  });

  it('disables the decrease control at the minimum size of 4', async () => {
    const onSizeChange = vi.fn();
    render(<Harness n={4} onSizeChange={onSizeChange} />);
    const dec = screen.getByRole('button', { name: /decrease grid size/i });
    expect((dec as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(dec);
    expect(onSizeChange).not.toHaveBeenCalled();
  });

  it('disables the increase control at the maximum size', async () => {
    const onSizeChange = vi.fn();
    render(<Harness n={MAX_N} onSizeChange={onSizeChange} />);
    const inc = screen.getByRole('button', { name: /increase grid size/i });
    expect((inc as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(inc);
    expect(onSizeChange).not.toHaveBeenCalled();
  });

  it('moves focus with the arrow keys', async () => {
    render(<Harness n={3} />);
    await userEvent.click(cell(0, 0));
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell(0, 1));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cell(1, 1));
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(cell(1, 0));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(cell(0, 0));
  });

  it('does not move focus past the grid edges', async () => {
    render(<Harness n={2} />);
    await userEvent.click(cell(0, 0));
    // Up and left at the top-left corner are no-ops.
    await userEvent.keyboard('{ArrowUp}{ArrowLeft}');
    expect(document.activeElement).toBe(cell(0, 0));
  });

  it('steps focus back to the previous cell on Backspace in an empty cell', async () => {
    render(<Harness n={2} />);
    await userEvent.click(cell(0, 1));
    await userEvent.keyboard('{Backspace}');
    expect(document.activeElement).toBe(cell(0, 0));
  });
});
