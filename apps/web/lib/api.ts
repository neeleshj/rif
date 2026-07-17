/**
 * Browser-side client for the same-origin Next.js route handlers, which forward
 * to the Fastify backend. Maps the status-code contract (200 mutant, 403 not
 * mutant, 400 invalid, 503 busy, 502 backend unreachable) onto a discriminated
 * result the UI can render.
 */

import type { ErrorResponse, MutantRequest, StatsResponse } from '@rif/shared';

export type MutantResult =
  | { kind: 'mutant' }
  | { kind: 'human' }
  | { kind: 'invalid'; error: string; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'error'; message: string };

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ErrorResponse).message === 'string'
  );
}

/** Submit a DNA grid for verification. Never throws; failures map to a result. */
export async function submitMutant(dna: string[]): Promise<MutantResult> {
  const body: MutantRequest = { dna };
  let res: Response;
  try {
    res = await fetch('/api/mutant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'error', message: 'Could not reach the detector. Is the API running?' };
  }

  if (res.status === 200) return { kind: 'mutant' };
  if (res.status === 403) return { kind: 'human' };

  if (res.status === 400) {
    const payload = await res.json().catch(() => null);
    if (isErrorResponse(payload)) {
      return { kind: 'invalid', error: payload.error, message: payload.message };
    }
    return { kind: 'invalid', error: 'Bad Request', message: 'The DNA grid was rejected.' };
  }

  if (res.status === 503) {
    const payload = await res.json().catch(() => null);
    const message = isErrorResponse(payload)
      ? payload.message
      : 'The detector is busy. Please retry in a moment.';
    return { kind: 'busy', message };
  }

  // The proxy answers 502 when it cannot reach the backend at all, and the body
  // says what to do about it. Falling through to "Unexpected response (502)"
  // threw away the one message that was actually actionable.
  if (res.status === 502) {
    const payload = await res.json().catch(() => null);
    const message = isErrorResponse(payload)
      ? payload.message
      : 'The detector service is unreachable. Confirm the API is running.';
    return { kind: 'error', message };
  }

  return { kind: 'error', message: `Unexpected response (${res.status}).` };
}

export type StatsResult =
  | { ok: true; stats: StatsResponse }
  | { ok: false; message: string };

/** Fetch usage stats. Never throws; failures map to a result. */
export async function fetchStats(): Promise<StatsResult> {
  let res: Response;
  try {
    res = await fetch('/api/stats', { headers: { Accept: 'application/json' } });
  } catch {
    return { ok: false, message: 'Could not reach the stats endpoint.' };
  }
  if (!res.ok) {
    // Prefer whatever the proxy or the backend said (a 502 explains that the
    // stats service is unreachable); the status code alone tells a user nothing.
    const payload = await res.json().catch(() => null);
    if (isErrorResponse(payload)) {
      return { ok: false, message: payload.message };
    }
    return { ok: false, message: `Stats unavailable (${res.status}).` };
  }
  const payload = (await res.json().catch(() => null)) as StatsResponse | null;
  if (!payload || typeof payload.count_mutant_dna !== 'number') {
    return { ok: false, message: 'Stats response was malformed.' };
  }
  return { ok: true, stats: payload };
}
