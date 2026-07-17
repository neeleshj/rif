/**
 * Same-origin route handler for POST /api/mutant. Does a fast, client-facing
 * validation pass with the shared helpers, then forwards to the Fastify backend
 * and relays its status and body verbatim. Fastify stays the authoritative
 * validator; this layer only rejects the obvious cases early and shapes errors.
 */

import { NextResponse } from 'next/server';
import { normaliseDna, validateDna, type ErrorResponse, type MutantRequest } from '@rif/shared';
import { parseIntEnv } from '@/lib/env';

// Mirror of the backend cap. The backend re-checks; this is only for fast
// feedback. Parsed with the same rules the backend applies, so a bad value fails
// loudly here instead of quietly turning the fast-reject off.
const MAX_GRID_SIZE = parseIntEnv(process.env, 'MAX_GRID_SIZE', 1000);

// Route handlers run on the server, so BACKEND_URL is never exposed to the browser.
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

/**
 * Error codes are the backend's, verbatim. Fastify answers a validation failure
 * with `bad_request` and this layer used to answer the same failure with
 * `Bad Request`; ResultView renders the field as it is given, so one problem
 * showed the user two different strings depending on which layer caught it. The
 * backend is authoritative on the contract, so the proxy matches it.
 */
function errorResponse(error: string, message: string, status: number): NextResponse<ErrorResponse> {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('bad_request', 'Request body must be valid JSON.', 400);
  }

  const dna = (body as Partial<MutantRequest> | null)?.dna;
  const normalised = Array.isArray(dna) && dna.every((row) => typeof row === 'string')
    ? normaliseDna(dna)
    : dna;

  const check = validateDna(normalised, MAX_GRID_SIZE);
  if (!check.valid) {
    return errorResponse('bad_request', check.message, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/mutant/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dna: check.dna } satisfies MutantRequest),
      cache: 'no-store',
    });
  } catch {
    // 502 has no backend counterpart (it means the backend never answered), but
    // it follows the same snake_case convention so the codes read as one set.
    return errorResponse(
      'bad_gateway',
      'The detector service is unreachable. Confirm the API is running.',
      502,
    );
  }

  // Relay the backend's status (200 / 403 / 400 / 503) and body unchanged.
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  });
}
