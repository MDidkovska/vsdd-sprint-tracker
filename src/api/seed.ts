/**
 * Seed data for the Phase A mock repository.
 *
 * This is realistic *demonstration* data, not production data. Hierarchy,
 * sprints and reporting windows are seed/admin values, not hard-coded rules.
 */
import { CURRENT_SCHEMA_VERSION, PROGRAMME_ID, PROGRAMME_NAME } from '../config';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy';
import type {
  ExceptionItem,
  RagStatuses,
  RagValue,
  UpdateDocument,
  UpdatePayload,
  UpdateState,
  UpdateVersion,
} from '../domain/update';
import { deriveEnvelopeFlags } from '../domain/schemas';

export const PROGRAMME: Programme = { id: PROGRAMME_ID, name: PROGRAMME_NAME, active: true };

export const STREAMS: Stream[] = [
  { id: 'MMM', programmeId: PROGRAMME_ID, name: 'MMM', sortOrder: 1, active: true },
  { id: 'OAH', programmeId: PROGRAMME_ID, name: 'OAH', sortOrder: 2, active: true },
  { id: 'GRMB', programmeId: PROGRAMME_ID, name: 'GRMB', sortOrder: 3, active: true },
  { id: 'O24', programmeId: PROGRAMME_ID, name: 'O24', sortOrder: 4, active: true },
  { id: 'Visa', programmeId: PROGRAMME_ID, name: 'Visa', sortOrder: 5, active: true },
];

export const TEAMS: Team[] = [
  { id: 'mmm-a', streamId: 'MMM', name: 'PTSB-VSDD MMM A', sortOrder: 1, active: true },
  { id: 'mmm-b', streamId: 'MMM', name: 'PTSB-VSDD MMM B', sortOrder: 2, active: true },
  { id: 'oah-ils', streamId: 'OAH', name: 'PTSB-VSDD OAH ILS', sortOrder: 1, active: true },
  { id: 'oah-sales', streamId: 'OAH', name: 'PTSB-VSDD OAH Sales', sortOrder: 2, active: true },
  { id: 'grmb', streamId: 'GRMB', name: 'PTSB-VSDD GRMB', sortOrder: 1, active: true },
  { id: 'o24-app', streamId: 'O24', name: 'PTSB-VSDD O24 App Modernization', sortOrder: 1, active: true },
  { id: 'o24-desktop', streamId: 'O24', name: 'PTSB-VSDD O24 Desktop Sunset', sortOrder: 2, active: true },
  { id: 'visa', streamId: 'Visa', name: 'VIS-PMNT', sortOrder: 1, active: true },
];

// Sprints: one closed (S13), the current one (S14), and a planned one (S15).
export const SPRINTS: Sprint[] = [
  { id: 'S13', programmeId: PROGRAMME_ID, label: 'Sprint 13', startDate: '2026-08-04', endDate: '2026-08-15', status: 'CLOSED' },
  { id: 'S14', programmeId: PROGRAMME_ID, label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT' },
  { id: 'S15', programmeId: PROGRAMME_ID, label: 'Sprint 15', startDate: '2026-09-07', endDate: '2026-09-18', status: 'PLANNED' },
];

export const CHECKPOINTS: ReportingCheckpoint[] = [
  { id: 'C13-1', sprintId: 'S13', weekNumber: 1, opensAt: '2026-08-04T08:00:00Z', dueAt: '2026-08-07T16:00:00Z', closesAt: '2026-08-08T16:00:00Z', status: 'CLOSED' },
  { id: 'C13-2', sprintId: 'S13', weekNumber: 2, opensAt: '2026-08-11T08:00:00Z', dueAt: '2026-08-14T16:00:00Z', closesAt: '2026-08-15T16:00:00Z', status: 'CLOSED' },
  { id: 'C14-1', sprintId: 'S14', weekNumber: 1, opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT' },
  { id: 'C14-2', sprintId: 'S14', weekNumber: 2, opensAt: '2026-08-31T08:00:00Z', dueAt: '2026-09-04T16:00:00Z', closesAt: '2026-09-07T16:00:00Z', status: 'UPCOMING' },
  { id: 'C15-1', sprintId: 'S15', weekNumber: 1, opensAt: '2026-09-07T08:00:00Z', dueAt: '2026-09-11T16:00:00Z', closesAt: '2026-09-14T16:00:00Z', status: 'UPCOMING' },
  { id: 'C15-2', sprintId: 'S15', weekNumber: 2, opensAt: '2026-09-14T08:00:00Z', dueAt: '2026-09-18T16:00:00Z', closesAt: '2026-09-21T16:00:00Z', status: 'UPCOMING' },
];

/** Teams the mock user may edit. o24-desktop is intentionally excluded to
 *  demonstrate the read-only / permission-denied state (R1.3). */
export const ASSIGNED_TEAM_IDS = TEAMS.map((t) => t.id).filter((id) => id !== 'o24-desktop');

type WeekState = UpdateState;

interface TeamSeed {
  teamId: string;
  streamId: string;
  rag: [RagValue, RagValue, RagValue];
  w1: WeekState;
  w2: WeekState;
  ask: boolean;
  /** When false, no Sprint 13 history exists — enables a genuine Missing state. */
  seedS13?: boolean;
}

const TEAM_SEEDS: TeamSeed[] = [
  { teamId: 'mmm-a', streamId: 'MMM', rag: ['GREEN', 'AMBER', 'AMBER'], w1: 'SUBMITTED', w2: 'DRAFT', ask: true },
  { teamId: 'mmm-b', streamId: 'MMM', rag: ['GREEN', 'GREEN', 'AMBER'], w1: 'DRAFT', w2: 'MISSING', ask: false },
  { teamId: 'oah-ils', streamId: 'OAH', rag: ['GREEN', 'AMBER', 'AMBER'], w1: 'SUBMITTED', w2: 'REOPENED', ask: true },
  // No Sprint 13 history: newly onboarded team, so Week 2 resolves to a true Missing.
  { teamId: 'oah-sales', streamId: 'OAH', rag: ['GREEN', 'AMBER', 'RED'], w1: 'DRAFT', w2: 'MISSING', ask: false, seedS13: false },
  { teamId: 'grmb', streamId: 'GRMB', rag: ['GREEN', 'GREEN', 'GREEN'], w1: 'SUBMITTED', w2: 'SUBMITTED', ask: false },
  { teamId: 'o24-app', streamId: 'O24', rag: ['GREEN', 'AMBER', 'AMBER'], w1: 'SUBMITTED', w2: 'DRAFT', ask: true },
  { teamId: 'o24-desktop', streamId: 'O24', rag: ['AMBER', 'AMBER', 'AMBER'], w1: 'SUBMITTED', w2: 'MISSING', ask: false },
  { teamId: 'visa', streamId: 'Visa', rag: ['GREEN', 'GREEN', 'GREEN'], w1: 'SUBMITTED', w2: 'MISSING', ask: false },
];

function streamLabel(streamId: string): string {
  return streamId === 'Visa' ? 'Visa payments' : streamId;
}

function defaultExceptions(seed: TeamSeed): ExceptionItem[] {
  const isPrimary = seed.teamId === 'mmm-a';
  if (isPrimary) {
    return [
      { id: `${seed.teamId}-ex1`, type: 'RISK', impact: 'Test data refresh may delay Week 2 execution and UAT entry.', owner: 'James T.', dueDate: '2026-08-29', decisionSupport: 'Confirm refreshed data by Thursday.', status: 'OPEN' },
      { id: `${seed.teamId}-ex2`, type: 'ISSUE', impact: 'Data masking failures are reducing regression throughput.', owner: 'Laura C.', dueDate: '2026-08-28', decisionSupport: 'Prioritise defect PAYC-1842.', status: 'OPEN' },
      { id: `${seed.teamId}-ex3`, type: 'BLOCKER', impact: 'Automation runners cannot access the stage environment; pipeline stopped.', owner: 'DevOps', dueDate: '2026-08-27', decisionSupport: 'Approve firewall rule today.', status: 'OPEN' },
    ];
  }
  const label = streamLabel(seed.streamId);
  if (seed.rag.includes('RED')) {
    return [
      { id: `${seed.teamId}-ex1`, type: 'ISSUE', impact: `${label} defect is affecting the committed execution path.`, owner: 'Delivery team', dueDate: '2026-08-29', decisionSupport: 'Confirm fix priority and retest window.', status: 'OPEN' },
    ];
  }
  if (seed.rag.includes('AMBER')) {
    return [
      { id: `${seed.teamId}-ex1`, type: 'RISK', impact: `${label} environment availability may compress the test window.`, owner: 'Environment lead', dueDate: '2026-08-30', decisionSupport: 'Confirm environment slot and recovery plan.', status: 'OPEN' },
    ];
  }
  return [];
}

function makePayload(seed: TeamSeed, week: 1 | 2): UpdatePayload {
  const isPrimary = seed.teamId === 'mmm-a';
  const label = streamLabel(seed.streamId);
  const suffix = week === 1 ? 'Week 1' : 'Week 2';
  const idLen = seed.teamId.length;

  return {
    goals: {
      business: isPrimary
        ? 'Enable the updated MMM customer journey for the September release.'
        : `Enable the planned ${label} business capability for the target release.`,
      technicalTesting: isPrimary
        ? 'Validate the end-to-end journey and close critical regression gaps.'
        : `Validate end-to-end ${label} journeys and close priority coverage gaps.`,
      sprintCommitment: isPrimary
        ? 'Execute 120 tests, validate priority fixes and raise release evidence.'
        : `Complete committed ${label} testing and produce auditable release evidence.`,
      nextWeekCommitment: isPrimary
        ? 'Complete blocked tests, retest PAYC-1842 and confirm release readiness.'
        : `Close remaining ${suffix} gaps, retest fixes and confirm the next readiness decision.`,
    },
    qualityEvidence: {
      planned: isPrimary ? 120 : 80 + idLen * 4,
      executed: isPrimary ? 84 : 52 + idLen * 3,
      passed: isPrimary ? 79 : 48 + idLen * 3,
      openCritical: seed.rag.includes('RED') ? 2 : seed.rag.includes('AMBER') ? 1 : 0,
      blocked: seed.rag.includes('RED') ? 9 : seed.rag.includes('AMBER') ? 5 : 1,
      automationPercent: isPrimary ? 18 : Math.min(55, 12 + idLen * 3),
    },
    achievements: isPrimary
      ? 'Test execution reached 70% of plan (84 / 120).\nPass rate is 94%.\nCritical issue fix is in progress.\nRemaining priority tests are planned for Week 2.'
      : `${label} priority scenarios executed.\nBusiness review completed with minor comments.\nRegression evidence refreshed for ${suffix}.`,
    aiValue: {
      useCase: 'AI-assisted test case generation',
      measurableBenefit: isPrimary ? '27% reduction in test case design effort' : 'Faster structured test design',
      humanValidation: 'Test lead review against requirements and business rules',
      nextExperimentConstraint: 'Extend to priority regression with human approval retained',
    },
    exceptions: defaultExceptions(seed),
    leadershipAsk: seed.ask
      ? isPrimary
        ? 'Approve stage access today and confirm the test-data refresh owner.'
        : `Confirm the decision owner for the open ${label} dependency.`
      : 'None',
    statusRationale: '',
    metricsNote: '',
  };
}

function rag(seed: TeamSeed): RagStatuses {
  return { business: seed.rag[0], delivery: seed.rag[1], release: seed.rag[2] };
}

export interface SeededData {
  documents: Map<string, UpdateDocument>;
  versions: UpdateVersion[];
  /** documents armed to simulate a concurrent edit on first mutating call. */
  conflictArmedDocIds: Set<string>;
}

export function docKey(teamId: string, sprintId: string, checkpointId: string): string {
  return `${teamId}|${sprintId}|${checkpointId}`;
}

function makeDocument(
  seed: TeamSeed,
  sprintId: string,
  checkpointId: string,
  week: 1 | 2,
  state: UpdateState,
  timestamp: string,
): UpdateDocument {
  const payload = makePayload(seed, week);
  const flags = deriveEnvelopeFlags(payload);
  return {
    id: docKey(seed.teamId, sprintId, checkpointId),
    programmeId: PROGRAMME_ID,
    streamId: seed.streamId,
    teamId: seed.teamId,
    sprintId,
    checkpointId,
    state,
    revision: state === 'SUBMITTED' ? 3 : 2,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag: rag(seed),
    hasBlocker: flags.hasBlocker,
    hasLeadershipAsk: flags.hasLeadershipAsk,
    createdAt: '2026-08-24T09:00:00Z',
    updatedAt: timestamp,
    updatedBy: 'seed',
    submittedAt: state === 'SUBMITTED' ? timestamp : undefined,
    payload,
  };
}

function makeVersion(doc: UpdateDocument, versionNumber: number): UpdateVersion {
  return {
    id: `${doc.teamId}-${doc.sprintId}-${doc.checkpointId}-v${versionNumber}`,
    teamId: doc.teamId,
    sprintId: doc.sprintId,
    checkpointId: doc.checkpointId,
    versionNumber,
    submittedBy: 'seed',
    submittedAt: doc.submittedAt ?? doc.updatedAt,
    schemaVersion: doc.schemaVersion,
    rag: doc.rag,
    hasBlocker: doc.hasBlocker,
    hasLeadershipAsk: doc.hasLeadershipAsk,
    payload: structuredClone(doc.payload),
  };
}

/** Build a fresh set of seeded data (called once per repository instance). */
export function buildSeededData(): SeededData {
  const documents = new Map<string, UpdateDocument>();
  const versions: UpdateVersion[] = [];

  for (const seed of TEAM_SEEDS) {
    // Sprint 14 — Week 1
    if (seed.w1 !== 'MISSING') {
      const doc = makeDocument(seed, 'S14', 'C14-1', 1, seed.w1, '2026-08-25T09:14:00Z');
      documents.set(doc.id, doc);
      if (seed.w1 === 'SUBMITTED') versions.push(makeVersion(doc, 1));
    }
    // Sprint 14 — Week 2
    if (seed.w2 !== 'MISSING') {
      const doc = makeDocument(seed, 'S14', 'C14-2', 2, seed.w2, '2026-08-26T08:30:00Z');
      documents.set(doc.id, doc);
      if (seed.w2 === 'SUBMITTED') versions.push(makeVersion(doc, 1));
    }
    // Sprint 13 — closed, submitted immutable evidence (unless the team has no history).
    if (seed.seedS13 !== false) {
      const closedDoc = makeDocument(seed, 'S13', 'C13-2', 2, 'SUBMITTED', '2026-08-14T15:30:00Z');
      documents.set(closedDoc.id, closedDoc);
      versions.push(makeVersion(closedDoc, 1));
    }
  }

  // Arm one editable draft to demonstrate a revision conflict on next save.
  const conflictArmedDocIds = new Set<string>([docKey('mmm-b', 'S14', 'C14-1')]);

  return { documents, versions, conflictArmedDocIds };
}
