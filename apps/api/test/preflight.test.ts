/**
 * Unit tests for the startup database preflight: URL redaction, error
 * classification, operator-facing message text, and the retry loop.
 *
 * The module is pure and takes an injectable `sleep`, so nothing here needs a
 * database or real wall-clock time. The retry tests pass `sleep: async () => {}`
 * and capture the delays that would have been awaited.
 *
 * Message assertions deliberately check meaningful substrings (the redacted URL
 * and the actionable hint) rather than whole blobs, so wording tweaks do not
 * break the suite while a dropped instruction still would.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  classifyStartupError,
  formatStartupError,
  redactDatabaseUrl,
  runDbPreflight,
  type DbStartupErrorKind,
} from '../src/db/preflight.js';

/** Build an error carrying a driver `code`, the shape postgres.js throws. */
function codedError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * The real shape postgres.js surfaces for a refused localhost connection:
 * localhost resolves to both ::1 and 127.0.0.1, Node tries both, and reports an
 * AggregateError whose own `code` is ECONNREFUSED and whose nested `errors`
 * carry the per-address failures.
 */
function refusedAggregate(): AggregateError {
  const ipv6 = codedError('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED');
  const ipv4 = codedError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED');
  return new AggregateError([ipv6, ipv4], 'All connection attempts failed');
}

describe('redactDatabaseUrl', () => {
  it('replaces the password with *** and does not leak the secret', () => {
    const out = redactDatabaseUrl('postgres://user:secret@host:5432/db');
    expect(out).toBe('postgres://user:***@host:5432/db');
    // The point of the whole function: the literal secret must be gone.
    expect(out).not.toContain('secret');
  });

  it('keeps the username, host, port and database visible', () => {
    // Redaction has to stay useful for debugging: everything except the
    // password is what tells the operator which URL was actually tried.
    const out = redactDatabaseUrl('postgres://admin:hunter2@db.internal:6543/rif');
    expect(out).toBe('postgres://admin:***@db.internal:6543/rif');
    expect(out).not.toContain('hunter2');
  });

  it('returns a URL with a username but no password unchanged', () => {
    const url = 'postgres://postgres@localhost:5432/rif';
    expect(redactDatabaseUrl(url)).toBe(url);
  });

  it('returns a URL with no userinfo at all unchanged', () => {
    const url = 'postgres://localhost:5432/rif';
    expect(redactDatabaseUrl(url)).toBe(url);
  });

  it('redacts a password containing a colon', () => {
    // Only the FIRST colon separates user from password, so the rest of the
    // userinfo is password and must go, colons included.
    const out = redactDatabaseUrl('postgres://user:pa:ss:word@host:5432/db');
    expect(out).toBe('postgres://user:***@host:5432/db');
    expect(out).not.toContain('pa:ss');
    expect(out).not.toContain('word');
  });

  it('redacts a url-encoded password', () => {
    const out = redactDatabaseUrl('postgres://user:p%40ss%3Aw%2Frd@host:5432/db');
    expect(out).toBe('postgres://user:***@host:5432/db');
    expect(out).not.toContain('%40');
    expect(out).not.toContain('%2F');
  });

  it('redacts an empty password', () => {
    const out = redactDatabaseUrl('postgres://user:@host:5432/db');
    expect(out).toBe('postgres://user:***@host:5432/db');
  });

  /**
   * A literal unencoded `@` inside the password. `@` is required to be
   * percent-encoded in a URL, so a correct .env never produces this, but
   * redaction is exactly the code that must not assume well-formed input: the
   * string it is handed is the one about to be printed to a log.
   *
   * The userinfo therefore runs to the LAST `@` in the authority. Splitting on
   * the first would emit the tail of the secret verbatim, which is what the
   * `ss@host` assertion pins down.
   */
  it('fully redacts a password containing a literal @', () => {
    const out = redactDatabaseUrl('postgres://user:p@ss@host:5432/db');
    // No fragment of the secret may survive, not even as part of the host.
    expect(out).not.toContain('ss@host');
    expect(out).not.toContain('p@ss');
    expect(out).toBe('postgres://user:***@host:5432/db');
  });

  it('splits on the last @ when the password holds several unencoded ones', () => {
    const out = redactDatabaseUrl('postgres://user:a@b@c@host:5432/db');
    expect(out).toBe('postgres://user:***@host:5432/db');
    // Every intermediate `@` belongs to the password, so none may reappear.
    expect(out).not.toContain('a@b');
    expect(out).not.toContain('b@c');
    expect(out).not.toContain('c@host');
  });

  it('redacts a password containing a literal @ when the URL has no path', () => {
    // With no '/', '?' or '#' the authority runs to the end of the string, so
    // the last-@ scan has no delimiter to anchor against.
    const out = redactDatabaseUrl('postgres://user:p@ss@host');
    expect(out).toBe('postgres://user:***@host');
    expect(out).not.toContain('ss@host');
  });

  it('preserves the query string after the path byte-identically', () => {
    const out = redactDatabaseUrl('postgres://user:secret@host:5432/db?sslmode=require&application_name=rif');
    expect(out).toBe('postgres://user:***@host:5432/db?sslmode=require&application_name=rif');
    expect(out).not.toContain('secret');
  });

  it('does not touch an @ or a colon that appears after the path', () => {
    // The userinfo is the only place a password can live, so a later @ in a
    // query value must survive untouched.
    const url = 'postgres://localhost:5432/db?user=a@b.com&opts=x:y';
    expect(redactDatabaseUrl(url)).toBe(url);
  });

  it('does not throw on a garbage non-URL string', () => {
    expect(() => redactDatabaseUrl('not a url at all')).not.toThrow();
    expect(redactDatabaseUrl('not a url at all')).toBe('not a url at all');
  });

  it('does not throw on an empty string', () => {
    expect(redactDatabaseUrl('')).toBe('');
  });
});

describe('classifyStartupError', () => {
  it('classifies SQLSTATE 42P01 as missing_schema', () => {
    expect(classifyStartupError(codedError('relation "dna_record" does not exist', '42P01'))).toBe('missing_schema');
  });

  it('classifies SQLSTATE 3D000 as missing_database', () => {
    expect(classifyStartupError(codedError('database "rif" does not exist', '3D000'))).toBe('missing_database');
  });

  it('classifies a bare ECONNREFUSED as unreachable', () => {
    expect(classifyStartupError(codedError('connect ECONNREFUSED', 'ECONNREFUSED'))).toBe('unreachable');
  });

  it('classifies an AggregateError carrying ECONNREFUSED in nested errors as unreachable', () => {
    // The real localhost shape: both ::1 and 127.0.0.1 refused.
    expect(classifyStartupError(refusedAggregate())).toBe('unreachable');
  });

  it('finds a nested code when the AggregateError itself has no code', () => {
    const aggregate = new AggregateError(
      [codedError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED')],
      'All connection attempts failed',
    );
    expect(classifyStartupError(aggregate)).toBe('unreachable');
  });

  it('classifies a code reached through a cause chain as unreachable', () => {
    const root = codedError('getaddrinfo ENOTFOUND db.invalid', 'ENOTFOUND');
    const middle = Object.assign(new Error('connection failed'), { cause: root });
    const outer = Object.assign(new Error('startup query failed'), { cause: middle });
    expect(classifyStartupError(outer)).toBe('unreachable');
  });

  it('lets SQLSTATE classification win over a socket code', () => {
    // A missing schema does not fix itself by waiting, so it must not be
    // misread as a retriable connection blip if both codes are present.
    const aggregate = new AggregateError(
      [codedError('connection closed', 'ECONNRESET')],
      'startup failed',
    );
    Object.assign(aggregate, { code: '42P01' });
    expect(classifyStartupError(aggregate)).toBe('missing_schema');

    const nestedCatalog = Object.assign(new Error('outer'), {
      code: 'ECONNREFUSED',
      cause: codedError('database "rif" does not exist', '3D000'),
    });
    expect(classifyStartupError(nestedCatalog)).toBe('missing_database');
  });

  it('classifies a plain Error as unknown', () => {
    expect(classifyStartupError(new Error('boom'))).toBe('unknown');
  });

  it('classifies null and undefined as unknown', () => {
    expect(classifyStartupError(null)).toBe('unknown');
    expect(classifyStartupError(undefined)).toBe('unknown');
  });

  it('classifies a non-object throw as unknown', () => {
    expect(classifyStartupError('some string')).toBe('unknown');
    expect(classifyStartupError(42)).toBe('unknown');
  });

  it('classifies an unrecognised SQLSTATE as unknown', () => {
    expect(classifyStartupError(codedError('permission denied', '42501'))).toBe('unknown');
  });

  it('survives a self-referential cause without recursing forever', () => {
    const err: { code: string; cause?: unknown } = { code: 'unhelpful' };
    err.cause = err;
    expect(classifyStartupError(err)).toBe('unknown');
  });

  /**
   * A two-step cycle: a -> b -> a. The direct self-reference above is caught by
   * the first `seen` check, but a longer loop only terminates if visited nodes
   * are remembered across the whole walk.
   *
   * The explicit timeout is the point of the test: a regression here hangs
   * rather than fails, and an unbounded walk would otherwise stall CI instead of
   * reporting.
   */
  it('survives a two-step cause cycle without hanging', { timeout: 1000 }, () => {
    const a: { code: string; cause?: unknown } = { code: 'unhelpful-a' };
    const b: { code: string; cause?: unknown } = { code: 'unhelpful-b' };
    a.cause = b;
    b.cause = a;
    expect(classifyStartupError(a)).toBe('unknown');
  });

  it('still finds a real code inside a cause cycle', () => {
    // Terminating the walk must not mean abandoning it: the useful code sits on
    // the second node of the loop and still has to be classified.
    const outer: { message: string; cause?: unknown } = { message: 'startup query failed' };
    const inner = codedError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED') as Error & {
      code: string;
      cause?: unknown;
    };
    outer.cause = inner;
    inner.cause = outer;
    expect(classifyStartupError(outer)).toBe('unreachable');
  });
});

describe('formatStartupError', () => {
  const REDACTED = 'postgres://user:***@localhost:5432/rif';
  const ALL_KINDS: DbStartupErrorKind[] = ['unreachable', 'missing_database', 'missing_schema', 'unknown'];

  it.each(ALL_KINDS)('includes the redacted URL for kind %s', (kind) => {
    expect(formatStartupError(kind, REDACTED)).toContain(REDACTED);
  });

  it.each(ALL_KINDS)('points at the README for kind %s', (kind) => {
    expect(formatStartupError(kind, REDACTED)).toContain('README.md');
  });

  it('tells an unreachable database to check that Postgres is up and the URL is right', () => {
    const msg = formatStartupError('unreachable', REDACTED);
    expect(msg).toContain('pg_isready');
    expect(msg).toContain('DATABASE_URL');
  });

  it('tells a missing database to create it and apply the schema', () => {
    const msg = formatStartupError('missing_database', REDACTED);
    expect(msg).toContain('createdb');
    expect(msg).toContain('npm run db:setup');
  });

  it('tells a missing schema to run db:setup', () => {
    const msg = formatStartupError('missing_schema', REDACTED);
    expect(msg).toContain('npm run db:setup');
    // The distinguishing point of this kind: the connection itself was fine.
    expect(msg).toContain('reachable');
  });

  it('says an unknown failure was unexpected and offers the debug log level', () => {
    const msg = formatStartupError('unknown', REDACTED);
    expect(msg).toContain('unexpected');
    expect(msg).toContain('LOG_LEVEL=debug');
  });

  it('does not invent a hint it cannot deliver on for the unknown kind', () => {
    // 'unknown' means we do not know the fix, so it must not claim db:setup
    // will help; that would send the operator down a wrong path.
    expect(formatStartupError('unknown', REDACTED)).not.toContain('npm run db:setup');
  });
});

describe('runDbPreflight', () => {
  /** A sleep that records what it was asked to wait for and returns instantly. */
  function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
    const delays: number[] = [];
    return {
      delays,
      sleep: async (ms: number): Promise<void> => {
        delays.push(ms);
      },
    };
  }

  it('returns the value on first success and calls fn exactly once', async () => {
    const fn = vi.fn(async (): Promise<string> => 'ok');
    await expect(runDbPreflight(fn, { sleep: async () => {} })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries an unreachable error and succeeds on a later attempt', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(refusedAggregate())
      .mockResolvedValueOnce('connected');

    await expect(runDbPreflight(fn, { sleep: async () => {} })).resolves.toBe('connected');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a missing_schema error and rethrows it', async () => {
    // Waiting does not create a table, so this must fail on the first try.
    const err = codedError('relation "dna_record" does not exist', '42P01');
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(err);

    await expect(runDbPreflight(fn, { sleep: async () => {} })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a missing_database error', async () => {
    const err = codedError('database "rif" does not exist', '3D000');
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(err);

    await expect(runDbPreflight(fn, { sleep: async () => {} })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry an unknown error', async () => {
    const err = new Error('boom');
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(err);

    await expect(runDbPreflight(fn, { sleep: async () => {} })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after `attempts` tries and rethrows the LAST error', async () => {
    const first = codedError('refused 1', 'ECONNREFUSED');
    const second = codedError('refused 2', 'ECONNREFUSED');
    const third = codedError('refused 3', 'ECONNREFUSED');
    const fn = vi
      .fn<() => Promise<never>>()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)
      .mockRejectedValueOnce(third);

    // The last error is the freshest evidence, so that is what the caller sees.
    await expect(runDbPreflight(fn, { attempts: 3, sleep: async () => {} })).rejects.toBe(third);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honours a custom attempts budget', async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(codedError('refused', 'ECONNREFUSED'));

    await expect(runDbPreflight(fn, { attempts: 5, sleep: async () => {} })).rejects.toThrow('refused');
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('runs fn exactly once when attempts is 1, with no sleep', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(codedError('refused', 'ECONNREFUSED'));

    await expect(runDbPreflight(fn, { attempts: 1, sleep })).rejects.toThrow('refused');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('calls onRetry once per retry with the attempt number', async () => {
    const onRetry = vi.fn<(attempt: number, err: unknown) => void>();
    const err = codedError('refused', 'ECONNREFUSED');
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('connected');

    await expect(runDbPreflight(fn, { onRetry, sleep: async () => {} })).resolves.toBe('connected');
    // Two retries for three attempts: the breadcrumb is per retry, not per try.
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, err);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, err);
  });

  it('does not call onRetry when the first attempt succeeds', async () => {
    const onRetry = vi.fn<(attempt: number, err: unknown) => void>();
    await expect(runDbPreflight(async () => 'ok', { onRetry, sleep: async () => {} })).resolves.toBe('ok');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not call onRetry for a non-retriable error', async () => {
    const onRetry = vi.fn<(attempt: number, err: unknown) => void>();
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(codedError('no table', '42P01'));

    await expect(runDbPreflight(fn, { onRetry, sleep: async () => {} })).rejects.toThrow('no table');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('backs off exponentially with the default 250ms base', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(codedError('refused', 'ECONNREFUSED'));

    await expect(runDbPreflight(fn, { sleep })).rejects.toThrow('refused');
    // Three attempts means two waits, doubling each time, and no trailing sleep
    // after the final failure: the whole budget is under a second.
    expect(delays).toEqual([250, 500]);
  });

  it('doubles a custom base delay', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(codedError('refused', 'ECONNREFUSED'));

    await expect(runDbPreflight(fn, { attempts: 4, delayMs: 10, sleep })).rejects.toThrow('refused');
    expect(delays).toEqual([10, 20, 40]);
  });

  it('does not sleep after the attempt that succeeds', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(codedError('refused', 'ECONNREFUSED'))
      .mockResolvedValueOnce('connected');

    await expect(runDbPreflight(fn, { sleep })).resolves.toBe('connected');
    expect(delays).toEqual([250]);
  });
});
