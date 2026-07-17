/**
 * Same-origin route handler for GET /api/stats. Forwards to the Fastify backend
 * and relays its status and body. The backend serves this from in-memory
 * counters and sets its own cache headers; here we simply avoid caching the
 * proxy hop so the figures stay fresh in the demo.
 */

import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

export async function GET(): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/stats/`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'Bad Gateway', message: 'The stats service is unreachable.' },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  });
}
