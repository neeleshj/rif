/**
 * Global test setup: start the MSW server, reset handlers and the DOM between
 * tests, and clean up React Testing Library mounts. Loaded via `setupFiles`
 * in vitest.config.ts (after test/native-globals.ts), so every suite gets an
 * isolated, deterministic environment.
 *
 * Networking: native-globals installed an http-based `fetch` that MSW's
 * ClientRequest interceptor handles cleanly. `server.listen()` re-patches
 * globalThis.fetch with MSW's own fetch proxy (which, under happy-dom, locks
 * mocked body streams), so we re-install the http-based fetch afterwards and
 * wrap it to resolve the app's same-origin relative URLs ("/api/...").
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ORIGIN, server } from './msw';

beforeAll(() => {
  // Capture the http-based fetch installed by native-globals.ts before MSW
  // swaps globalThis.fetch for its own proxy.
  const baseFetch = globalThis.fetch;

  // Fail loudly if a test triggers an unexpected network call.
  server.listen({ onUnhandledRequest: 'error' });

  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return baseFetch(`${ORIGIN}${input}`, init);
    }
    return baseFetch(input, init);
  }) as typeof fetch;

  // MSW installs fetch as a non-writable property, so redefine it.
  Object.defineProperty(globalThis, 'fetch', {
    value: wrapped,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
