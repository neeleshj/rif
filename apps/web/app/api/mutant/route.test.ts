// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/msw';
import { POST } from './route';

const BACKEND = 'http://localhost:3001';

function postRequest(body: unknown) {
  return new Request('http://localhost:3000/api/mutant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/mutant route handler', () => {
  it('fast-rejects non-JSON bodies with 400 and does not call the backend', async () => {
    const spy = vi.fn();
    server.use(http.post(`${BACKEND}/mutant/`, () => spy() ?? new HttpResponse(null, { status: 200 })));

    const res = await POST(postRequest('not json'));
    expect(res.status).toBe(400);
    const body = await res.json();
    // The backend's spelling, which the proxy must match: ResultView renders this
    // field verbatim, so a divergence shows two strings for one problem.
    expect(body.error).toBe('bad_request');
    expect(spy).not.toHaveBeenCalled();
  });

  it('fast-rejects a non-square grid without forwarding', async () => {
    const spy = vi.fn();
    server.use(http.post(`${BACKEND}/mutant/`, () => spy() ?? new HttpResponse(null, { status: 200 })));

    const res = await POST(postRequest({ dna: ['ATG'] }));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fast-rejects an invalid character without forwarding', async () => {
    const spy = vi.fn();
    server.use(http.post(`${BACKEND}/mutant/`, () => spy() ?? new HttpResponse(null, { status: 200 })));

    const res = await POST(postRequest({ dna: ['AXGC', 'CAGT', 'TTAG', 'GCTA'] }));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('forwards a valid grid (normalised) and relays a 200 mutant', async () => {
    let forwarded: unknown;
    server.use(
      http.post(`${BACKEND}/mutant/`, async ({ request }) => {
        forwarded = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const res = await POST(postRequest({ dna: ['atgc', 'cagt', 'ttag', 'gcta'] }));
    expect(res.status).toBe(200);
    // The row payload is uppercased before it reaches the backend.
    expect(forwarded).toEqual({ dna: ['ATGC', 'CAGT', 'TTAG', 'GCTA'] });
  });

  it('relays a backend 403 verbatim', async () => {
    server.use(http.post(`${BACKEND}/mutant/`, () => new HttpResponse(null, { status: 403 })));
    const res = await POST(postRequest({ dna: ['ATGC', 'CAGT', 'TTAG', 'GCTA'] }));
    expect(res.status).toBe(403);
  });

  it('relays a backend 400 body and status', async () => {
    server.use(
      http.post(`${BACKEND}/mutant/`, () =>
        HttpResponse.json({ error: 'bad_request', message: 'nope' }, { status: 400 }),
      ),
    );
    const res = await POST(postRequest({ dna: ['ATGC', 'CAGT', 'TTAG', 'GCTA'] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request', message: 'nope' });
  });

  it('relays a backend 503 busy response', async () => {
    server.use(
      http.post(`${BACKEND}/mutant/`, () =>
        // The code Fastify actually sends for a full write queue.
        HttpResponse.json({ error: 'unavailable', message: 'busy' }, { status: 503 }),
      ),
    );
    const res = await POST(postRequest({ dna: ['ATGC', 'CAGT', 'TTAG', 'GCTA'] }));
    expect(res.status).toBe(503);
  });

  it('returns 502 when the backend is unreachable', async () => {
    server.use(http.post(`${BACKEND}/mutant/`, () => HttpResponse.error()));
    const res = await POST(postRequest({ dna: ['ATGC', 'CAGT', 'TTAG', 'GCTA'] }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('bad_gateway');
  });
});
