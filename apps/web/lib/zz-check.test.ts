import { describe, it, expect } from 'vitest';
import { randomGrid, gridToDna } from '/Users/neeleshjoshi/projects/neeleshj/rif/apps/web/lib/grid';
import { isMutant } from '/Users/neeleshjoshi/projects/neeleshj/rif/apps/api/src/algorithm/isMutant';

describe('randomGrid mutant promise', () => {
  it('always yields a mutant for n=8', () => {
    let bad = 0;
    for (let i = 0; i < 200000; i++) {
      const dna = gridToDna(randomGrid(8, true));
      if (!isMutant(dna)) { bad++; if (bad===1) console.log('FIRST FAILURE:\n' + dna.join('\n')); }
    }
    console.log('non-mutant count out of 200000:', bad);
    expect(bad).toBe(0);
  });
});
