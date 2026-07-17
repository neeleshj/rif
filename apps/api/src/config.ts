/**
 * Environment parsing and validation. Fail fast on a missing DATABASE_URL or an
 * out-of-range value, so a misconfigured process never starts serving. Every
 * knob has a sensible default that matches `.env.example`.
 */

export type NodeEnv = 'development' | 'production' | 'test';

export interface Config {
  apiPort: number;
  databaseUrl: string;
  nodeEnv: NodeEnv;
  /** Reject grids larger than this many rows (guards oversized-grid abuse). */
  maxGridSize: number;
  /** Bound on the in-process write buffer; shed load (503) beyond it. */
  queueMaxSize: number;
  /** Flush a batch once this many records are buffered. */
  batchSize: number;
  /** Flush a batch at least this often, in milliseconds. */
  batchIntervalMs: number;
  /**
   * Wall-clock budget for draining the write queue on SIGTERM. A healthy drain
   * finishes well inside this; an unreachable database makes shutdown give up
   * here rather than retry every batch against a database that is not answering.
   */
  drainTimeoutMs: number;
  logLevel: string;
  /** Fraction (0..1) of successful requests to log; all errors are always kept. */
  logSampleRate: number;
  /** Allowed CORS origin (the frontend). */
  webOrigin: string;
}

type Env = Record<string, string | undefined>;

function requireString(env: Env, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function parseIntEnv(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function parseFloatEnv(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Environment variable ${key} must be a number in [${min}, ${max}], got "${raw}"`);
  }
  return value;
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  const value = raw ?? 'development';
  if (value === 'development' || value === 'production' || value === 'test') {
    return value;
  }
  throw new Error(`NODE_ENV must be development, production, or test, got "${value}"`);
}

/** Build a validated Config from an environment map (defaults to process.env). */
export function loadConfig(env: Env = process.env): Config {
  return {
    apiPort: parseIntEnv(env, 'API_PORT', 3001),
    databaseUrl: requireString(env, 'DATABASE_URL'),
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    maxGridSize: parseIntEnv(env, 'MAX_GRID_SIZE', 1000),
    queueMaxSize: parseIntEnv(env, 'QUEUE_MAX_SIZE', 100000),
    batchSize: parseIntEnv(env, 'BATCH_SIZE', 500),
    batchIntervalMs: parseIntEnv(env, 'BATCH_INTERVAL_MS', 100),
    drainTimeoutMs: parseIntEnv(env, 'DRAIN_TIMEOUT_MS', 5000),
    logLevel: env.LOG_LEVEL ?? 'info',
    logSampleRate: parseFloatEnv(env, 'LOG_SAMPLE_RATE', 0.001, 0, 1),
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3000',
  };
}
