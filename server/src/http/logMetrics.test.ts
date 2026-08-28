/**
 * Tests for the log-derived observability counters (task 10.6).
 *
 * These prove the counter derivation:
 *  - reads ONLY request-completion lines and ignores everything else;
 *  - buckets requests by HTTP status class and separates client (4xx) from
 *    server (5xx) errors, with the headline error counter tracking 5xx;
 *  - computes latency percentiles/min/max/mean over `responseTime`.
 *
 * The final test wires the REAL Fastify logger through `buildServer` and derives
 * the counters from the exact bytes pino writes, so the parser stays honest
 * against the live "request completed" / "request errored" log shape.
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import {
  deriveCountersFromLogLines,
  deriveCountersFromLogText,
  isCompletionRecord,
  parseLogLine,
  percentile,
} from './logMetrics.js';

/** Build a synthetic pino-style completion line. */
function completion(statusCode: number, responseTime: number): string {
  return JSON.stringify({
    level: statusCode >= 500 ? 50 : 30,
    time: Date.now(),
    msg: statusCode >= 500 ? 'request errored' : 'request completed',
    res: { statusCode },
    responseTime,
  });
}

describe('parseLogLine', () => {
  it('returns null for blank or non-JSON lines', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('   ')).toBeNull();
    expect(parseLogLine('not json')).toBeNull();
  });

  it('parses a JSON log line', () => {
    const record = parseLogLine(completion(200, 12.5));
    expect(record?.res?.statusCode).toBe(200);
    expect(record?.responseTime).toBe(12.5);
  });
});

describe('isCompletionRecord', () => {
  it('accepts only lines with a status code and responseTime', () => {
    expect(isCompletionRecord({ res: { statusCode: 200 }, responseTime: 5 })).toBe(true);
    // "incoming request" has no responseTime.
    expect(isCompletionRecord({ msg: 'incoming request', req: {} } as never)).toBe(false);
    // An ad-hoc application log has neither.
    expect(isCompletionRecord({ msg: 'draft saved' })).toBe(false);
    // Missing responseTime is not a completion line.
    expect(isCompletionRecord({ res: { statusCode: 200 } })).toBe(false);
  });
});

describe('percentile', () => {
  it('uses nearest-rank and clamps the ends', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 100)).toBe(50);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('deriveCountersFromLogLines', () => {
  it('ignores non-completion lines and counts only completions', () => {
    const lines = [
      JSON.stringify({ msg: 'incoming request', req: { method: 'GET', url: '/x' } }),
      completion(200, 10),
      JSON.stringify({ msg: 'draft saved', teamId: 'team-1' }),
      completion(200, 20),
      '',
      'garbage',
    ];
    const counters = deriveCountersFromLogLines(lines);
    expect(counters.totalRequests).toBe(2);
    expect(counters.successCount).toBe(2);
    expect(counters.latencyMs.count).toBe(2);
  });

  it('buckets by status class and separates client vs server errors', () => {
    const lines = [
      completion(200, 5),
      completion(201, 6),
      completion(304, 2),
      completion(400, 4),
      completion(403, 4),
      completion(404, 4),
      completion(500, 30),
    ];
    const counters = deriveCountersFromLogLines(lines);
    expect(counters.totalRequests).toBe(7);
    expect(counters.byStatusClass).toEqual({ '2xx': 2, '3xx': 1, '4xx': 3, '5xx': 1 });
    expect(counters.successCount).toBe(3); // 2xx + 3xx
    expect(counters.clientErrorCount).toBe(3);
    expect(counters.serverErrorCount).toBe(1);
    // The headline error counter tracks server errors only.
    expect(counters.errorCount).toBe(1);
    expect(counters.errorRate).toBeCloseTo(1 / 7, 2);
  });

  it('computes latency percentiles/min/max/mean over responseTime', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const counters = deriveCountersFromLogLines(values.map((v) => completion(200, v)));
    expect(counters.latencyMs.count).toBe(10);
    expect(counters.latencyMs.min).toBe(10);
    expect(counters.latencyMs.max).toBe(100);
    expect(counters.latencyMs.mean).toBe(55);
    expect(counters.latencyMs.p50).toBe(50); // nearest-rank: ceil(0.5*10)=5 -> index 4
    expect(counters.latencyMs.p90).toBe(90);
    expect(counters.latencyMs.p95).toBe(100);
  });

  it('returns zeroed counters for an empty stream', () => {
    const counters = deriveCountersFromLogLines([]);
    expect(counters.totalRequests).toBe(0);
    expect(counters.errorCount).toBe(0);
    expect(counters.errorRate).toBe(0);
    expect(counters.latencyMs).toEqual({
      count: 0,
      min: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      mean: 0,
    });
  });
});

describe('derivation against the real Fastify logger', () => {
  it('parses the live request-completed / request-errored log shape', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        chunks.push(chunk.toString());
        done();
      },
    });

    const app = buildServer(
      { checkReadiness: async () => true },
      { logLevel: 'info', logStream: stream },
    );
    app.get('/api/v1/ok', async () => ({ ok: true }));
    app.get('/api/v1/boom', async () => {
      throw new Error('unexpected failure');
    });
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/v1/ok' });
    await app.inject({ method: 'GET', url: '/api/v1/ok' });
    await app.inject({ method: 'GET', url: '/api/v1/boom' });
    await app.close();

    const counters = deriveCountersFromLogText(chunks.join(''));
    // Two 200s and one 500 were actually served.
    expect(counters.totalRequests).toBe(3);
    expect(counters.successCount).toBe(2);
    expect(counters.serverErrorCount).toBe(1);
    expect(counters.errorCount).toBe(1);
    // Latency was measured from the real responseTime field.
    expect(counters.latencyMs.count).toBe(3);
    expect(counters.latencyMs.max).toBeGreaterThanOrEqual(0);
  });
});
