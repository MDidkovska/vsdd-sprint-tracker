# PoC readiness benchmark — Leadership View (task 10.6)

Generated: 2026-08-27T23:48:56.977Z
Environment: Node v25.3.0 on darwin/arm64
Measured reads per scenario: 300 (after a 20-request warm-up)

This is a **local PoC benchmark**, not production-scale load testing. It
exercises the reporting-summary projection (the backend behind the Leadership
View) at the PoC target of **8 teams** and at a **2x growth margin (16 teams)**,
per requirements.md §6 (Performance) and design.md §2 (Observability). The
latency and error counters below are **derived from the existing structured
logs** (`server/src/http/logMetrics.ts` parsing the clean, secret-free log
stream from `logger.ts`) — no enterprise observability platform is used
(deferred to Phase B).

Reproduce with:

```
cd server && npm run benchmark:leadership
```

## Latency and error counters (from the structured logs)

| Teams | Streams | Reads | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | mean (ms) | 5xx errors | 4xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 (PoC target) | 2 | 300 | 1.72 | 3.27 | 4.27 | 6.19 | 1.97 | 0 | 0 |
| 16 (2x growth margin) | 4 | 300 | 2.04 | 4.15 | 6.15 | 7.67 | 2.35 | 0 | 0 |

The read mix per scenario cycles through: the unfiltered whole-programme
projection, a submitted-only filter, a RAG filter and a single-stream
drill-down — the same reads the Leadership View issues.

## Seeded cell-state mix (per scenario)

Realistic distribution across teams so the projection resolves Submitted,
Draft, derived-Stale and Missing cells (Missing carries a null RAG so it can
never read as a false Green).

| Teams | Submitted | Draft | Stale | Missing |
| --- | --- | --- | --- | --- |
| 8 (PoC target) | 5 | 1 | 1 | 1 |
| 16 (2x growth margin) | 10 | 2 | 2 | 2 |

## Interpretation (PoC)

- At the PoC scale (8 teams) and the 2x growth margin (16 teams) the Leadership
  View projection responds well within the interactive budget on local
  hardware, with **zero server (5xx) errors** across the measured reads.
- The 4xx column reflects only intentional validation/authorisation responses
  from the read mix (there should be none for these valid, authorised reads).
- The figures are machine-dependent; treat them as a **local PoC baseline**,
  not the Phase B production target (Leadership View interactive within three
  seconds at p75 for up to 200 teams and 24 months of history — see
  requirements.md §6). Production-scale load testing is deferred to Phase B.

## How the counters are derived

The server already emits one structured completion line per request
(`{ res: { statusCode }, responseTime }, "request completed"`). Those lines
carry operational metadata only — never a password, session token or free-text
update content (task 10.2). `deriveCountersFromLogText` parses that stream to
produce request counts, per-status-class buckets, a server-error counter and
latency percentiles. The same logic runs against captured logs in the benchmark
and can be pointed at real log files by an operator.
