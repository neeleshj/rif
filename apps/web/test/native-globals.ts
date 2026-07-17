/**
 * happy-dom swaps in its own `fetch`, `ReadableStream`, `Blob` and encoders.
 * Its fetch re-wraps MSW's mocked Response and locks the body stream, so a
 * JSON body cannot be read ("Invalid state: ReadableStream is locked"). Under
 * the plain Node environment MSW works fine, the difference is purely these
 * happy-dom globals.
 *
 * To keep happy-dom's DOM (needed by React Testing Library) while getting a
 * clean, readable network layer, we:
 *   1. restore Node's native stream/encoding globals, and
 *   2. install a small `fetch` implemented on Node's `http`/`https`. MSW's
 *      ClientRequest interceptor transparently intercepts that request and
 *      returns the mocked response, which we surface as a native Response with
 *      an unlocked body.
 *
 * Loaded as the first setupFile so it runs before MSW is imported.
 */

import http from 'node:http';
import https from 'node:https';
import { Blob } from 'node:buffer';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

const g = globalThis as unknown as Record<string, unknown>;

g.ReadableStream = ReadableStream;
g.WritableStream = WritableStream;
g.TransformStream = TransformStream;
g.Blob = Blob;
g.TextEncoder = TextEncoder;
g.TextDecoder = TextDecoder;

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  if (input instanceof Request) {
    const text = await input.text();
    return text === '' ? undefined : text;
  }
  const body = init?.body;
  if (body == null) return undefined;
  return typeof body === 'string' ? body : String(body);
}

function collectHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const merge = (h?: HeadersInit) => {
    if (!h) return;
    new Headers(h).forEach((value, key) => {
      out[key] = value;
    });
  };
  if (input instanceof Request) merge(input.headers);
  merge(init?.headers);
  return out;
}

/**
 * A minimal fetch over Node's http/https, sufficient for the app's same-origin
 * JSON calls. MSW intercepts the underlying request, so no real socket is
 * opened during tests.
 */
const nodeFetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url =
    input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
  const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
  const transport = url.startsWith('https:') ? https : http;

  return new Promise<Response>((resolve, reject) => {
    void readBody(input, init).then((body) => {
      const req = transport.request(
        url,
        { method, headers: collectHeaders(input, init) },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const payload = Buffer.concat(chunks);
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
              else if (value != null) headers.set(key, value);
            }
            const status = res.statusCode ?? 200;
            // 204/304 must not carry a body per the Response spec.
            const hasBody = status !== 204 && status !== 304 && payload.length > 0;
            resolve(
              new Response(hasBody ? payload : null, {
                status,
                statusText: res.statusMessage ?? '',
                headers,
              }),
            );
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (body != null) req.write(body);
      req.end();
    }, reject);
  });
}) as typeof fetch;

Object.defineProperty(globalThis, 'fetch', {
  value: nodeFetch,
  writable: true,
  configurable: true,
});
