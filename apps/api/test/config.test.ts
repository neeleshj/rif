/**
 * Unit tests for loadConfig: defaults, required values, and fail-fast parsing.
 * loadConfig takes an env map, so no process.env mutation is needed.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const MINIMAL = { DATABASE_URL: 'postgres://localhost/test' };

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    const config = loadConfig(MINIMAL);
    expect(config).toMatchObject({
      apiPort: 3001,
      databaseUrl: 'postgres://localhost/test',
      nodeEnv: 'development',
      maxGridSize: 1000,
      queueMaxSize: 100000,
      batchSize: 500,
      batchIntervalMs: 100,
      logLevel: 'info',
      logSampleRate: 0.001,
      webOrigin: 'http://localhost:3000',
    });
  });

  it('reads and coerces overrides from the env map', () => {
    const config = loadConfig({
      ...MINIMAL,
      API_PORT: '4000',
      NODE_ENV: 'production',
      MAX_GRID_SIZE: '50',
      QUEUE_MAX_SIZE: '10',
      BATCH_SIZE: '5',
      BATCH_INTERVAL_MS: '25',
      LOG_LEVEL: 'debug',
      LOG_SAMPLE_RATE: '0.5',
      WEB_ORIGIN: 'https://example.test',
    });
    expect(config.apiPort).toBe(4000);
    expect(config.nodeEnv).toBe('production');
    expect(config.maxGridSize).toBe(50);
    expect(config.queueMaxSize).toBe(10);
    expect(config.batchSize).toBe(5);
    expect(config.batchIntervalMs).toBe(25);
    expect(config.logLevel).toBe('debug');
    expect(config.logSampleRate).toBe(0.5);
    expect(config.webOrigin).toBe('https://example.test');
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is empty', () => {
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('throws on a non-positive integer knob', () => {
    expect(() => loadConfig({ ...MINIMAL, API_PORT: '0' })).toThrow(/positive integer/);
    expect(() => loadConfig({ ...MINIMAL, BATCH_SIZE: 'abc' })).toThrow(/positive integer/);
  });

  it('throws on an out-of-range float', () => {
    expect(() => loadConfig({ ...MINIMAL, LOG_SAMPLE_RATE: '2' })).toThrow(/\[0, 1\]/);
    expect(() => loadConfig({ ...MINIMAL, LOG_SAMPLE_RATE: 'x' })).toThrow(/\[0, 1\]/);
  });

  it('throws on an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...MINIMAL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
