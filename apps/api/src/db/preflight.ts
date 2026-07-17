/**
 * Startup database preflight: turn a raw driver failure into a message a person
 * can act on.
 *
 * The API cannot serve a single request without Postgres, so a database that is
 * down at boot is a hard stop. What this module changes is the shape of that
 * stop: instead of an unhandled AggregateError with a stack trace into
 * node_modules/postgres, the process prints what went wrong, which URL it tried
 * (password redacted), and which of the README "How to Run" steps to check.
 *
 * The classification exists because the two most likely local mistakes need
 * different fixes: "Postgres is not running / the URL is wrong" versus
 * "connected fine, but `npm run db:setup` was never run".
 *
 * Everything here is pure and injectable (see `sleep`) so the failure paths are
 * testable without a database.
 */

/** What went wrong at boot, in terms of what the operator has to do about it. */
export type DbStartupErrorKind =
  /** Nothing answered on the host/port: Postgres is down or DATABASE_URL is wrong. */
  | 'unreachable'
  /** The server answered, but the named database does not exist. */
  | 'missing_database'
  /** Connected to the database, but the tables are not there: db:setup never ran. */
  | 'missing_schema'
  /** Anything else. Fall back to showing the error itself. */
  | 'unknown';

/** Socket-level failures that mean "nothing is listening / cannot get there". */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  // postgres.js raises these itself rather than surfacing a socket errno.
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECTION_REFUSED',
]);

/** Postgres SQLSTATE 42P01: undefined_table. The schema was never applied. */
const UNDEFINED_TABLE = '42P01';
/** Postgres SQLSTATE 3D000: invalid_catalog_name. The database does not exist. */
const INVALID_CATALOG_NAME = '3D000';

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Read the `code` of an error and of any nested errors. Node raises an
 * AggregateError when a host resolves to several addresses (localhost gives both
 * ::1 and 127.0.0.1), and the useful code can sit on either level.
 */
function collectCodes(err: unknown, out: Set<string> = new Set(), seen: WeakSet<object> = new WeakSet()): Set<string> {
  const code = errorCode(err);
  if (code !== undefined) out.add(code);
  if (typeof err !== 'object' || err === null) return out;

  // Track visited nodes: a `cause` chain that loops back on itself would
  // otherwise recurse until the stack blows, and this runs while we are already
  // handling a failure.
  if (seen.has(err)) return out;
  seen.add(err);

  const nested = (err as { errors?: unknown }).errors;
  if (Array.isArray(nested)) {
    for (const inner of nested) collectCodes(inner, out, seen);
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) collectCodes(cause, out, seen);
  return out;
}

/** Classify a boot-time database failure into the fix it implies. */
export function classifyStartupError(err: unknown): DbStartupErrorKind {
  const codes = collectCodes(err);
  if (codes.has(UNDEFINED_TABLE)) return 'missing_schema';
  if (codes.has(INVALID_CATALOG_NAME)) return 'missing_database';
  for (const code of codes) {
    if (UNREACHABLE_CODES.has(code)) return 'unreachable';
  }
  return 'unknown';
}

/**
 * Blank out the password in a connection URL so it is safe to print.
 *
 * Only the userinfo segment of the authority can carry a password, so only that
 * is rewritten and the rest of the string is left byte-identical. This matters
 * even though the local default URL has no password: the same message is printed
 * whatever DATABASE_URL holds, and a logged secret does not get un-logged.
 */
export function redactDatabaseUrl(url: string): string {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(url);
  if (!scheme) return url;
  const start = scheme[0].length;

  // The authority runs from the scheme to the first path, query, or fragment
  // delimiter. Everything after that is copied through untouched.
  const rest = url.slice(start);
  const delimiter = /[/?#]/.exec(rest);
  const authorityEnd = delimiter ? delimiter.index : rest.length;
  const authority = rest.slice(0, authorityEnd);

  // The userinfo runs to the LAST '@' in the authority, not the first. A
  // password is supposed to percent-encode '@', but a hand-written .env may not,
  // and splitting on the first '@' would then emit the tail of the secret
  // verbatim. This function's whole job is to be safe on malformed input.
  const at = authority.lastIndexOf('@');
  if (at === -1) return url;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  if (colon === -1) return url;

  return `${url.slice(0, start)}${userinfo.slice(0, colon)}:***${authority.slice(at)}${rest.slice(authorityEnd)}`;
}

const README_HINT =
  'See the "How to Run" steps in README.md.\n' +
  'Re-run with LOG_LEVEL=debug to see the underlying driver error.';

/**
 * Build the operator-facing message for a failed boot. Kept separate from the
 * printing so tests can assert the text without capturing stdio.
 */
export function formatStartupError(kind: DbStartupErrorKind, redactedUrl: string): string {
  const header = `The API could not start because it cannot use the database.\n\n  DATABASE_URL: ${redactedUrl}\n`;

  switch (kind) {
    case 'unreachable':
      return (
        `${header}\nNothing answered at that address. Check:\n` +
        '  1. Is PostgreSQL running?  (pg_isready, or: brew services list)\n' +
        '  2. Is DATABASE_URL correct in the .env at the repo root?\n' +
        '     Copy it from .env.example if the file is missing.\n' +
        `  3. Is the host and port right for your Postgres?\n\n${README_HINT}`
      );
    case 'missing_database':
      return (
        `${header}\nPostgreSQL is running, but that database does not exist. Create it,\n` +
        'then apply the schema:\n\n' +
        '  createdb rif\n' +
        '  npm run db:setup\n\n' +
        `Or point DATABASE_URL at a database that does exist.\n\n${README_HINT}`
      );
    case 'missing_schema':
      return (
        `${header}\nThe database is reachable, but its tables are missing. This usually means\n` +
        'the schema step was skipped. Run:\n\n' +
        '  npm run db:setup\n\n' +
        `That creates the tables, the dna_ratio function, and the seed row.\n\n${README_HINT}`
      );
    case 'unknown':
      return `${header}\nThe database rejected the startup query for an unexpected reason.\n\n${README_HINT}`;
  }
}

export interface PreflightOptions {
  /** Total tries, including the first. Default 3. */
  attempts?: number;
  /** Delay before the first retry, in ms. Doubles each retry. Default 250. */
  delayMs?: number;
  /** Called before each retry, for a debug-level breadcrumb. */
  onRetry?: (attempt: number, err: unknown) => void;
  /** Injectable for tests, so a retry path does not cost real wall-clock time. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run a startup database query, retrying only while the database looks
 * unreachable.
 *
 * A database that is still accepting connections a moment after the API starts
 * is a common local case (Postgres launching alongside the app), and a couple of
 * short retries turn that from a hard failure into a non-event. The budget is
 * deliberately tiny: 3 tries at 250ms then 500ms is well under a second, so a
 * genuinely dead database still reports almost immediately.
 *
 * Only 'unreachable' is retried. A missing schema or a missing database will not
 * fix itself by waiting, so those fail on the first try.
 */
export async function runDbPreflight<T>(fn: () => Promise<T>, opts: PreflightOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.delayMs ?? 250;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const retriable = classifyStartupError(err) === 'unreachable';
      if (!retriable || attempt === attempts) break;
      opts.onRetry?.(attempt, err);
      await sleep(baseDelay * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}
