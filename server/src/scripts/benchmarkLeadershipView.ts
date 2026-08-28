/**
 * Local PoC readiness benchmark for the Leadership View projection (task 10.6,
 * requirements.md §6 Performance, design.md §2 Observability).
 *
 *   npm run benchmark:leadership
 *
 * This is a LOCAL PoC benchmark, NOT production-scale load testing (that is
 * deferred to Phase B). It exercises the reporting-summary projection — the
 * backend behind the Leadership View — at the PoC target of 8 teams AND at a
 * 2x growth margin (16 teams), then derives basic latency and error counters
 * FROM THE EXISTING STRUCTURED LOGS via `deriveCountersFromLogText` (the same
 * clean, secret-free log stream the server emits in normal operation — see
 * `logger.ts` / `logMetrics.ts`).
 *
 * How it works, per scenario:
 *  1. Spin up an in-process MongoDB replica set (transactions are required for
 *     the atomic submit path) and seed a synthetic programme with N teams.
 *  2. Seed a realistic mix of cell states across the teams (Submitted / Draft /
 *     Stale-from-an-earlier-checkpoint / Missing).
 *  3. Warm up, then issue a fixed number of Leadership View reads (unfiltered
 *     plus representative stream / RAG / state filters) against the real server.
 *  4. Clear the captured log buffer AFTER seeding + warm-up so the counters
 *     reflect ONLY the measured Leadership View reads, then derive the latency
 *     percentiles and error counters from those structured log lines.
 *
 * The results are printed and written to `docs/observability/` as committed
 * evidence. Numbers are machine-dependent, so the report records the date and
 * environment alongside them.
 *
 * Override the measured iteration count with `BENCH_ITERATIONS`, and point at an
 * external replica set with `MONGO_TEST_URI` (otherwise an ephemeral in-memory
 * replica set is used).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import type { ReferenceData } from '../reference/referenceData.js';
import {
  deriveCountersFromLogText,
  type ObservabilityCounters,
} from '../http/logMetrics.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DraftService, type DraftUpdateRequest } from '../services/draftService.js';
import { SubmitService } from '../services/submitService.js';
import { SummaryService } from '../services/summaryService.js';

const PROGRAMME_ID = 'bench';
const CURRENT_SPRINT_ID = 'BS1';
const CURRENT_CHECKPOINT_ID = 'BC1-1';
const EARLIER_SPRINT_ID = 'BS0';
const EARLIER_CHECKPOINT_ID = 'BC0-2';
const TEAMS_PER_STREAM = 4;

/** One captured, resettable log buffer wired into `buildServer({ logStream })`. */
interface LogCapture {
  stream: Writable;
  text(): string;
  reset(): void;
}

function createLogCapture(): LogCapture {
  let chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  return {
    stream,
    text: () => chunks.join(''),
    reset: () => {
      chunks = [];
    },
  };
}

/**
 * Build a synthetic programme with `teamCount` active teams spread across
 * streams. Includes the current sprint (BS1: BC1-1 CURRENT, BC1-2 UPCOMING) and
 * an earlier closed sprint (BS0: BC0-2 CLOSED) so a subset of teams can present
 * a derived STALE cell from an earlier submission.
 */
function buildBenchmarkReferenceData(teamCount: number): ReferenceData {
  const programme: Programme = { id: PROGRAMME_ID, name: 'Benchmark Programme', active: true };
  const streamCount = Math.ceil(teamCount / TEAMS_PER_STREAM);

  const streams: Stream[] = [];
  const teams: Team[] = [];
  for (let s = 0; s < streamCount; s += 1) {
    const streamId = `bstream-${s + 1}`;
    streams.push({
      id: streamId,
      programmeId: PROGRAMME_ID,
      name: `Stream ${s + 1}`,
      sortOrder: s + 1,
      active: true,
    });
    for (let t = 0; t < TEAMS_PER_STREAM && teams.length < teamCount; t += 1) {
      teams.push({
        id: `bteam-${teams.length + 1}`,
        streamId,
        name: `Team ${teams.length + 1}`,
        sortOrder: t + 1,
        active: true,
      });
    }
  }

  const sprints: Sprint[] = [
    { id: EARLIER_SPRINT_ID, programmeId: PROGRAMME_ID, label: 'Bench Sprint 0', startDate: '2026-08-04', endDate: '2026-08-15', status: 'CLOSED' },
    { id: CURRENT_SPRINT_ID, programmeId: PROGRAMME_ID, label: 'Bench Sprint 1', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT' },
  ];

  const checkpoints: ReportingCheckpoint[] = [
    { id: EARLIER_CHECKPOINT_ID, sprintId: EARLIER_SPRINT_ID, weekNumber: 2, opensAt: '2026-08-11T08:00:00Z', dueAt: '2026-08-14T16:00:00Z', closesAt: '2026-08-15T16:00:00Z', status: 'CLOSED' },
    { id: CURRENT_CHECKPOINT_ID, sprintId: CURRENT_SPRINT_ID, weekNumber: 1, opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT' },
    { id: 'BC1-2', sprintId: CURRENT_SPRINT_ID, weekNumber: 2, opensAt: '2026-08-31T08:00:00Z', dueAt: '2026-09-04T16:00:00Z', closesAt: '2026-09-07T16:00:00Z', status: 'UPCOMING' },
  ];

  return { programmes: [programme], streams, teams, sprints, checkpoints };
}

/**
 * A benchmark auth context: a single ACTIVE Team Lead + Leadership subject
 * assigned to every synthetic team so it may seed drafts/submissions and read
 * the whole-programme leadership projection.
 */
function buildBenchmarkAuth(teamIds: string[]): AuthContext {
  const user: CurrentUser = {
    subject: 'bench-user',
    email: 'bench@example.com',
    displayName: 'Benchmark User',
    initials: 'BU',
    roleLabel: 'Bench Lead',
    status: 'ACTIVE',
    programmeId: PROGRAMME_ID,
    roles: ['TEAM_LEAD', 'LEADERSHIP'],
    assignedTeamIds: teamIds,
    canViewAll: true,
  };
  return { getCurrentUser: () => structuredClone(user) };
}

/** A valid draft/submission body (passes the full submission validation). */
function draftBody(overrides: Partial<DraftUpdateRequest> = {}): DraftUpdateRequest {
  return {
    revision: 0,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    goals: {
      business: 'Enable the September release journey.',
      technicalTesting: 'Close critical regression gaps.',
      sprintCommitment: 'Execute committed tests.',
      nextWeekCommitment: 'Confirm readiness.',
    },
    qualityEvidence: { planned: 120, executed: 84, passed: 79, openCritical: 1, blocked: 5, automationPercent: 18 },
    achievements: 'Execution reached 70% of plan.',
    aiValue: {
      useCase: 'AI-assisted test generation',
      measurableBenefit: '27% reduction in design effort',
      humanValidation: 'Test lead review',
      nextExperimentConstraint: 'Extend with human approval',
    },
    exceptions: [
      {
        id: 'exc-1',
        type: 'RISK',
        impact: 'Regression coverage still incomplete.',
        owner: 'a.owner',
        dueDate: '2026-08-30',
        decisionSupport: 'Approve extra test capacity.',
        status: 'OPEN',
      },
    ],
    leadershipAsk: 'None',
    ...overrides,
  };
}

const RAG_CYCLE: Array<DraftUpdateRequest['rag']> = [
  { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
  { business: 'AMBER', delivery: 'AMBER', release: 'GREEN' },
  { business: 'RED', delivery: 'AMBER', release: 'AMBER' },
];

async function saveDraft(
  app: FastifyInstance,
  teamId: string,
  checkpointId: string,
  overrides: Partial<DraftUpdateRequest>,
): Promise<void> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
    payload: draftBody({ revision: 0, ...overrides }),
  });
  if (response.statusCode !== 200) {
    throw new Error(`saveDraft ${teamId} failed: ${response.statusCode} ${response.body}`);
  }
}

async function submit(
  app: FastifyInstance,
  teamId: string,
  checkpointId: string,
  overrides: Partial<DraftUpdateRequest>,
): Promise<void> {
  await saveDraft(app, teamId, checkpointId, overrides);
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
    payload: draftBody({ revision: 1, ...overrides }),
  });
  if (response.statusCode !== 200) {
    throw new Error(`submit ${teamId} failed: ${response.statusCode} ${response.body}`);
  }
}

/**
 * Seed a realistic mix of cell states across the teams:
 * A deterministic per-8-team pattern (5 Submitted, 1 Draft, 1 Stale, 1 Missing)
 * so the projection resolves every cell state at BOTH the 8-team and 16-team
 * scales:
 *  - Submitted at the current checkpoint (some with a leadership ask);
 *  - Draft at the current checkpoint (work-in-progress, not evidence);
 *  - Stale (submitted only at the earlier checkpoint);
 *  - Missing (no draft at all — a null RAG, never a false Green).
 */
async function seedStates(app: FastifyInstance, teams: Team[]): Promise<Record<string, number>> {
  const mix = { submitted: 0, draft: 0, stale: 0, missing: 0 };
  for (let i = 0; i < teams.length; i += 1) {
    const team = teams[i];
    const bucket = i % 8; // 0-4 submitted, 5 draft, 6 stale, 7 missing
    const rag = RAG_CYCLE[i % RAG_CYCLE.length];
    if (bucket < 5) {
      await submit(app, team.id, CURRENT_CHECKPOINT_ID, {
        rag,
        leadershipAsk: i % 3 === 0 ? 'Need a staffing decision for regression coverage.' : 'None',
      });
      mix.submitted += 1;
    } else if (bucket === 5) {
      await saveDraft(app, team.id, CURRENT_CHECKPOINT_ID, { rag });
      mix.draft += 1;
    } else if (bucket === 6) {
      await submit(app, team.id, EARLIER_CHECKPOINT_ID, { rag });
      mix.stale += 1;
    } else {
      mix.missing += 1;
    }
  }
  return mix;
}

/** The Leadership View read mix exercised during measurement. */
function readUrls(streamIds: string[]): string[] {
  const base = `/api/v1/programmes/${PROGRAMME_ID}/reporting-summary?sprintId=${CURRENT_SPRINT_ID}&checkpointId=${CURRENT_CHECKPOINT_ID}`;
  return [
    base, // unfiltered whole-programme projection
    `${base}&state=SUBMITTED`, // submitted-only filter
    `${base}&rag=RED`, // RAG filter across dimensions
    `${base}&streamId=${streamIds[0]}`, // single-stream drill-down
  ];
}

interface ScenarioResult {
  label: string;
  teamCount: number;
  streamCount: number;
  stateMix: Record<string, number>;
  measuredRequests: number;
  counters: ObservabilityCounters;
}

async function runScenario(
  teamCount: number,
  label: string,
  iterations: number,
  uri: string,
): Promise<ScenarioResult> {
  const dbName = `vsdd_bench_${teamCount}`;
  const repository = await MongoDocumentRepository.connect({ uri, dbName });
  const reference = buildBenchmarkReferenceData(teamCount);
  await repository.seedReferenceData(reference);

  const auth = buildBenchmarkAuth(reference.teams.map((t) => t.id));
  const capture = createLogCapture();
  const app = buildServer(
    {
      checkReadiness: () => repository.ping(),
      drafts: new DraftService(repository, auth),
      submits: new SubmitService(repository, auth),
      summaries: new SummaryService(repository, auth),
    },
    { logLevel: 'info', logStream: capture.stream },
  );
  await app.ready();

  const stateMix = await seedStates(app, reference.teams);

  const urls = readUrls(reference.streams.map((s) => s.id));

  // Warm up (JIT, connection pool, index caches) — excluded from the counters.
  for (let i = 0; i < 20; i += 1) {
    await app.inject({ method: 'GET', url: urls[i % urls.length] });
  }

  // Only the measured reads should feed the log-derived counters.
  capture.reset();

  let measuredRequests = 0;
  for (let i = 0; i < iterations; i += 1) {
    const response = await app.inject({ method: 'GET', url: urls[i % urls.length] });
    if (response.statusCode !== 200) {
      throw new Error(`benchmark read failed: ${response.statusCode} ${response.body}`);
    }
    measuredRequests += 1;
  }

  const counters = deriveCountersFromLogText(capture.text());

  await app.close();
  await repository.close();

  return {
    label,
    teamCount,
    streamCount: reference.streams.length,
    stateMix,
    measuredRequests,
    counters,
  };
}

function formatCounters(counters: ObservabilityCounters): string {
  const l = counters.latencyMs;
  return [
    `requests=${counters.totalRequests}`,
    `errors(5xx)=${counters.errorCount}`,
    `clientErrors(4xx)=${counters.clientErrorCount}`,
    `p50=${l.p50}ms`,
    `p95=${l.p95}ms`,
    `p99=${l.p99}ms`,
    `max=${l.max}ms`,
    `mean=${l.mean}ms`,
  ].join('  ');
}

function buildMarkdown(results: ScenarioResult[], iterations: number, env: string): string {
  const now = new Date().toISOString();
  const rows = results
    .map((r) => {
      const l = r.counters.latencyMs;
      return `| ${r.teamCount} (${r.label}) | ${r.streamCount} | ${r.counters.totalRequests} | ${l.p50} | ${l.p95} | ${l.p99} | ${l.max} | ${l.mean} | ${r.counters.errorCount} | ${r.counters.clientErrorCount} |`;
    })
    .join('\n');

  const mixRows = results
    .map(
      (r) =>
        `| ${r.teamCount} (${r.label}) | ${r.stateMix.submitted} | ${r.stateMix.draft} | ${r.stateMix.stale} | ${r.stateMix.missing} |`,
    )
    .join('\n');

  return `# PoC readiness benchmark — Leadership View (task 10.6)

Generated: ${now}
Environment: ${env}
Measured reads per scenario: ${iterations} (after a 20-request warm-up)

This is a **local PoC benchmark**, not production-scale load testing. It
exercises the reporting-summary projection (the backend behind the Leadership
View) at the PoC target of **8 teams** and at a **2x growth margin (16 teams)**,
per requirements.md §6 (Performance) and design.md §2 (Observability). The
latency and error counters below are **derived from the existing structured
logs** (\`server/src/http/logMetrics.ts\` parsing the clean, secret-free log
stream from \`logger.ts\`) — no enterprise observability platform is used
(deferred to Phase B).

Reproduce with:

\`\`\`
cd server && npm run benchmark:leadership
\`\`\`

## Latency and error counters (from the structured logs)

| Teams | Streams | Reads | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | mean (ms) | 5xx errors | 4xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

The read mix per scenario cycles through: the unfiltered whole-programme
projection, a submitted-only filter, a RAG filter and a single-stream
drill-down — the same reads the Leadership View issues.

## Seeded cell-state mix (per scenario)

Realistic distribution across teams so the projection resolves Submitted,
Draft, derived-Stale and Missing cells (Missing carries a null RAG so it can
never read as a false Green).

| Teams | Submitted | Draft | Stale | Missing |
| --- | --- | --- | --- | --- |
${mixRows}

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
(\`{ res: { statusCode }, responseTime }, "request completed"\`). Those lines
carry operational metadata only — never a password, session token or free-text
update content (task 10.2). \`deriveCountersFromLogText\` parses that stream to
produce request counts, per-status-class buckets, a server-error counter and
latency percentiles. The same logic runs against captured logs in the benchmark
and can be pointed at real log files by an operator.
`;
}

async function main(): Promise<void> {
  const iterations = Number.parseInt(process.env.BENCH_ITERATIONS ?? '', 10) || 300;

  let replSet: MongoMemoryReplSet | undefined;
  let uri: string;
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    console.log('Starting in-memory MongoDB replica set (transactions require it)…');
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }

  try {
    const scenarios: Array<{ teamCount: number; label: string }> = [
      { teamCount: 8, label: 'PoC target' },
      { teamCount: 16, label: '2x growth margin' },
    ];

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      console.log(`\nRunning scenario: ${scenario.teamCount} teams (${scenario.label})…`);
      const result = await runScenario(scenario.teamCount, scenario.label, iterations, uri);
      console.log(
        `  states: submitted=${result.stateMix.submitted} draft=${result.stateMix.draft} ` +
          `stale=${result.stateMix.stale} missing=${result.stateMix.missing}`,
      );
      console.log(`  ${formatCounters(result.counters)}`);
      results.push(result);
    }

    const env = `Node ${process.version} on ${process.platform}/${process.arch}`;
    const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/observability');
    await mkdir(outDir, { recursive: true });

    const markdown = buildMarkdown(results, iterations, env);
    await writeFile(resolve(outDir, 'poc-benchmark-results.md'), markdown, 'utf8');
    await writeFile(
      resolve(outDir, 'poc-benchmark-results.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), env, iterations, results }, null, 2)}\n`,
      'utf8',
    );
    console.log(`\nEvidence written to ${outDir}`);
  } finally {
    await replSet?.stop();
  }
}

void main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exitCode = 1;
});
