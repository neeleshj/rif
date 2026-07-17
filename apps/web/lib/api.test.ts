import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { ORIGIN, server } from '../test/msw';
import { fetchStats, submitMutant } from './api';

const mutant = (fn: Parameters<typeof http.post>[1]) =>
  server.use(http.post(`${ORIGIN}/api/mutant`, fn));
const stats = (fn: Parameters<typeof http.get>[1]) =>
  server.use(http.get(`${ORIGIN}/api/stats`, fn));

describe('submitMutant status mapping', () => {
  it('maps 200 to a mutant result', async () => {
    mutant(() => new HttpResponse(null, { status: 200 }));
    expect(await submitMutant(['ATGC'])).toEqual({ kind: 'mutant' });
  });

  it('maps 403 to a human result', async () => {
    mutant(() => new HttpResponse(null, { status: 403 }));
    expect(await submitMutant(['ATGC'])).toEqual({ kind: 'human' });
  });

  it('maps 400 with an error body to an invalid result', async () => {
    mutant(() =>
      HttpResponse.json(
        { error: 'bad_request', message: 'grid must be square' },
        { status: 400 },
      ),
    );
    expect(await submitMutant(['ATG'])).toEqual({
      kind: 'invalid',
      error: 'bad_request',
      message: 'grid must be square',
    });
  });

  it('falls back to a generic invalid message when the 400 body is not shaped', async () => {
    mutant(() => new HttpResponse('nope', { status: 400 }));
    const result = await submitMutant(['ATG']);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.error).toBe('bad_request');
      expect(result.message).toMatch(/rejected/i);
    }
  });

  it('maps 503 with a message to a busy result', async () => {
    mutant(() =>
      HttpResponse.json({ error: 'Busy', message: 'try later' }, { status: 503 }),
    );
    expect(await submitMutant(['ATGC'])).toEqual({ kind: 'busy', message: 'try later' });
  });

  it('maps 503 without a shaped body to a default busy message', async () => {
    mutant(() => new HttpResponse(null, { status: 503 }));
    const result = await submitMutant(['ATGC']);
    expect(result.kind).toBe('busy');
    if (result.kind === 'busy') expect(result.message).toMatch(/busy/i);
  });

  // The proxy answers 502 when it cannot reach the backend, and its body carries
  // the one message that tells the user what to do. It must not be discarded in
  // favour of a bare status code.
  it('surfaces the proxy message on a 502 with an error body', async () => {
    mutant(() =>
      HttpResponse.json(
        {
          error: 'bad_gateway',
          message: 'The detector service is unreachable. Confirm the API is running.',
        },
        { status: 502 },
      ),
    );
    expect(await submitMutant(['ATGC'])).toEqual({
      kind: 'error',
      message: 'The detector service is unreachable. Confirm the API is running.',
    });
  });

  it('falls back to the authored message on a 502 with no shaped body', async () => {
    mutant(() => new HttpResponse(null, { status: 502 }));
    const result = await submitMutant(['ATGC']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unreachable/i);
      // A bare "Unexpected response (502)" is the regression.
      expect(result.message).not.toMatch(/unexpected/i);
    }
  });

  it('maps an unexpected status to a generic error', async () => {
    mutant(() => new HttpResponse(null, { status: 500 }));
    const result = await submitMutant(['ATGC']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/500/);
  });

  it('maps a network failure to an error result', async () => {
    mutant(() => HttpResponse.error());
    const result = await submitMutant(['ATGC']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/reach/i);
  });
});

describe('fetchStats', () => {
  it('returns the parsed stats on success', async () => {
    stats(() =>
      HttpResponse.json({ count_mutant_dna: 3, count_human_dna: 2, ratio: 1.5 }),
    );
    const result = await fetchStats();
    expect(result).toEqual({
      ok: true,
      stats: { count_mutant_dna: 3, count_human_dna: 2, ratio: 1.5 },
    });
  });

  it('reports a malformed body', async () => {
    stats(() => HttpResponse.json({ wrong: true }));
    const result = await fetchStats();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/malformed/i);
  });

  /**
   * The guard used to check only count_mutant_dna, so a partial body sailed
   * through as ok:true and StatsView then threw a TypeError on
   * `stats.ratio.toFixed(2)`, blanking the page. Every field the view reads has
   * to be checked, or the guard is not a guard.
   */
  it.each([
    ['ratio missing', { count_mutant_dna: 3, count_human_dna: 2 }],
    ['count_human_dna missing', { count_mutant_dna: 3, ratio: 1.5 }],
    ['ratio not a number', { count_mutant_dna: 3, count_human_dna: 2, ratio: '1.5' }],
    ['a JSON null body', null],
    ['an array body', []],
  ])('reports a partial body as malformed rather than passing it on: %s', async (_label, body) => {
    stats(() => HttpResponse.json(body));
    const result = await fetchStats();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/malformed/i);
  });

  it('falls back to the status code when a non-ok response has no shaped body', async () => {
    stats(() => new HttpResponse(null, { status: 502 }));
    const result = await fetchStats();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Stats unavailable \(502\)/);
  });

  // The status code on its own tells a user nothing; whatever the proxy or the
  // backend said is the useful part.
  it('surfaces the error body message on a 502', async () => {
    stats(() =>
      HttpResponse.json(
        { error: 'bad_gateway', message: 'The stats service is unreachable.' },
        { status: 502 },
      ),
    );
    const result = await fetchStats();
    expect(result).toEqual({ ok: false, message: 'The stats service is unreachable.' });
  });

  it('surfaces the error body message on a 500 too, not just a 502', async () => {
    stats(() =>
      HttpResponse.json({ error: 'Internal', message: 'counters are cold' }, { status: 500 }),
    );
    const result = await fetchStats();
    expect(result).toEqual({ ok: false, message: 'counters are cold' });
  });

  it('reports a network failure', async () => {
    stats(() => HttpResponse.error());
    const result = await fetchStats();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/reach/i);
  });
});
