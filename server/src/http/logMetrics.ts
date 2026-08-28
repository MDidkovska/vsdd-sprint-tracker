/**
 * Basic latency and error counters DERIVED FROM the existing structured logs
 * (task 10.6, design.md §2 "Observability (PoC)").
 *
 * The PoC deliberately does NOT run an enterprise observability platform. It
 * instead derives a small, useful set of counters from the structured
 * application-log stream the server already emits (task 10.1/10.2, see
 * `logger.ts`). Fastify logs one completion line per request:
 *
 *   info : { res: { statusCode }, responseTime }, "request completed"
 *   error: { res: { statusCode }, err, responseTime }, "request errored"
 *
 * The `res` serializer reduces the reply to its `statusCode` only and the
 * request/response bodies and headers are never logged, so these lines carry
 * ONLY operational metadata — no password, session token or free-text update
 * content. That makes them safe to parse for counters here.
 *
 * This module is pure and stream-agnostic: it takes already-captured log lines
 * (as produced by pino) and returns counters. The benchmark script feeds it a
 * captured stream; an operator can pipe real log files through the same logic.
 */

/** A single parsed structured log record (only the fields we rely on). */
export interface LogRecord {
  level?: number;
  msg?: string;
  responseTime?: number;
  res?: { statusCode?: number };
  statusCode?: number;
}

/** Latency summary (milliseconds) derived from request completion lines. */
export interface LatencySummary {
  /** Number of completed requests the latencies were computed from. */
  count: number;
  min: number;
  /** Median (p50). */
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  /** Arithmetic mean. */
  mean: number;
}

/** Basic observability counters derived from the structured log stream. */
export interface ObservabilityCounters {
  /** Total completed requests observed in the logs. */
  totalRequests: number;
  /** Request count bucketed by HTTP status class (`2xx`, `4xx`, …). */
  byStatusClass: Record<string, number>;
  /** 2xx + 3xx responses. */
  successCount: number;
  /** 4xx responses (client errors). */
  clientErrorCount: number;
  /** 5xx responses (server errors). */
  serverErrorCount: number;
  /**
   * Server-error count — the headline "error counter". Excludes 4xx, which are
   * expected client/validation/authorisation outcomes rather than faults.
   */
  errorCount: number;
  /** Server errors as a fraction of total requests (0 when there is no traffic). */
  errorRate: number;
  /** Latency percentiles/min/max/mean over `responseTime`. */
  latencyMs: LatencySummary;
}

/**
 * Parse one log line into a {@link LogRecord}. Returns `null` for blank lines or
 * lines that are not valid JSON (defensive: a mixed stdout should not throw).
 */
export function parseLogLine(line: string): LogRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as LogRecord;
  } catch {
    return null;
  }
}

/**
 * A request-completion record is one that carries both a numeric `responseTime`
 * and a resolved status code (`res.statusCode`, or a top-level `statusCode`
 * fallback). "incoming request" lines and ad-hoc application logs are ignored.
 */
export function isCompletionRecord(record: LogRecord): boolean {
  return typeof record.responseTime === 'number' && getStatusCode(record) !== undefined;
}

function getStatusCode(record: LogRecord): number | undefined {
  const code = record.res?.statusCode ?? record.statusCode;
  return typeof code === 'number' ? code : undefined;
}

/**
 * Nearest-rank percentile over an ascending-sorted array (milliseconds).
 * `p` is a percentage in [0, 100]. Returns 0 for an empty input.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (p <= 0) return sortedAsc[0];
  if (p >= 100) return sortedAsc[sortedAsc.length - 1];
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index];
}

/** Round to two decimal places so reported figures stay readable. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Derive {@link ObservabilityCounters} from an iterable of raw log lines (each a
 * single pino JSON line). Only request-completion lines contribute; everything
 * else is skipped.
 */
export function deriveCountersFromLogLines(lines: Iterable<string>): ObservabilityCounters {
  const records: LogRecord[] = [];
  for (const line of lines) {
    const record = parseLogLine(line);
    if (record) records.push(record);
  }
  return deriveCountersFromRecords(records);
}

/** Split a captured multi-line log blob and derive counters from it. */
export function deriveCountersFromLogText(text: string): ObservabilityCounters {
  return deriveCountersFromLogLines(text.split('\n'));
}

/** Derive {@link ObservabilityCounters} from already-parsed records. */
export function deriveCountersFromRecords(records: Iterable<LogRecord>): ObservabilityCounters {
  const byStatusClass: Record<string, number> = {};
  const latencies: number[] = [];
  let totalRequests = 0;
  let successCount = 0;
  let clientErrorCount = 0;
  let serverErrorCount = 0;

  for (const record of records) {
    if (!isCompletionRecord(record)) continue;
    const statusCode = getStatusCode(record);
    if (statusCode === undefined) continue;

    totalRequests += 1;
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    byStatusClass[statusClass] = (byStatusClass[statusClass] ?? 0) + 1;

    if (statusCode >= 500) serverErrorCount += 1;
    else if (statusCode >= 400) clientErrorCount += 1;
    else successCount += 1;

    if (typeof record.responseTime === 'number' && Number.isFinite(record.responseTime)) {
      latencies.push(record.responseTime);
    }
  }

  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((acc, value) => acc + value, 0);
  const latencyMs: LatencySummary = {
    count: latencies.length,
    min: round2(latencies.length ? latencies[0] : 0),
    p50: round2(percentile(latencies, 50)),
    p90: round2(percentile(latencies, 90)),
    p95: round2(percentile(latencies, 95)),
    p99: round2(percentile(latencies, 99)),
    max: round2(latencies.length ? latencies[latencies.length - 1] : 0),
    mean: round2(latencies.length ? sum / latencies.length : 0),
  };

  return {
    totalRequests,
    byStatusClass,
    successCount,
    clientErrorCount,
    serverErrorCount,
    errorCount: serverErrorCount,
    errorRate: totalRequests === 0 ? 0 : round2(serverErrorCount / totalRequests),
    latencyMs,
  };
}
