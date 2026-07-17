// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/msw';
import { GET } from './route';

const BACKEND = 'http://localhost:3001';

describe('GET /api/stats route handler', () => {
  it('forwards to the backend and relays the stats body and status', async () => {
    server.use(
      http.get(`${BACKEND}/stats/`, () =>
        HttpResponse.json({ count_mutant_dna: 4, count_human_dna: 2, ratio: 2 }),
      ),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count_mutant_dna: 4, count_human_dna: 2, ratio: 2 });
  });

  it('relays a non-200 backend status', async () => {
    server.use(http.get(`${BACKEND}/stats/`, () => new HttpResponse(null, { status: 500 })));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('returns 502 when the stats backend is unreachable', async () => {
    server.use(http.get(`${BACKEND}/stats/`, () => HttpResponse.error()));
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('bad_gateway');
  });
});
