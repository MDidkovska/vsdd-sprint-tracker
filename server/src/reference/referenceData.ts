/**
 * Reference/config seed data for the PoC backend.
 *
 * This is realistic *demonstration* data (design.md §4a "Reference/config
 * documents for hierarchy, sprints, checkpoints and assignments"), NOT
 * production data. Hierarchy, sprints and reporting windows are seed/admin
 * values, never hard-coded business rules (requirements.md §4).
 *
 * The values MIRROR the frontend mock seed (`src/api/seed.ts`) so the PoC
 * backend and the replaceable frontend mock present one identical contract.
 * The seed is written into the document store through the vendor-neutral
 * repository adapter; no MongoDB specifics appear here.
 */
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import type { CurrentUser } from '../domain/identity.js';

/** Programme identifier/name (matches frontend config.ts). */
export const PROGRAMME_ID = 'vsdd';
export const PROGRAMME_NAME = 'VSDD';

export const PROGRAMME: Programme = {
  id: PROGRAMME_ID,
  name: PROGRAMME_NAME,
  active: true,
};

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

// Each sprint carries exactly two weekly checkpoints (requirements.md R2.1);
// one checkpoint is identified as CURRENT (R2.2).
export const CHECKPOINTS: ReportingCheckpoint[] = [
  { id: 'C13-1', sprintId: 'S13', weekNumber: 1, opensAt: '2026-08-04T08:00:00Z', dueAt: '2026-08-07T16:00:00Z', closesAt: '2026-08-08T16:00:00Z', status: 'CLOSED' },
  { id: 'C13-2', sprintId: 'S13', weekNumber: 2, opensAt: '2026-08-11T08:00:00Z', dueAt: '2026-08-14T16:00:00Z', closesAt: '2026-08-15T16:00:00Z', status: 'CLOSED' },
  { id: 'C14-1', sprintId: 'S14', weekNumber: 1, opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT' },
  { id: 'C14-2', sprintId: 'S14', weekNumber: 2, opensAt: '2026-08-31T08:00:00Z', dueAt: '2026-09-04T16:00:00Z', closesAt: '2026-09-07T16:00:00Z', status: 'UPCOMING' },
  { id: 'C15-1', sprintId: 'S15', weekNumber: 1, opensAt: '2026-09-07T08:00:00Z', dueAt: '2026-09-11T16:00:00Z', closesAt: '2026-09-14T16:00:00Z', status: 'UPCOMING' },
  { id: 'C15-2', sprintId: 'S15', weekNumber: 2, opensAt: '2026-09-14T08:00:00Z', dueAt: '2026-09-18T16:00:00Z', closesAt: '2026-09-21T16:00:00Z', status: 'UPCOMING' },
];

/**
 * Teams the mocked user may edit. `o24-desktop` is intentionally excluded to
 * mirror the frontend seed's read-only / permission-denied demonstration.
 */
export const ASSIGNED_TEAM_IDS: string[] = TEAMS.map((t) => t.id).filter(
  (id) => id !== 'o24-desktop',
);

/**
 * The mocked authenticated subject for the local PoC (design.md §4b). Real
 * enterprise OIDC identity is Phase 8; this stands in until then.
 */
export const MOCK_CURRENT_USER: CurrentUser = {
  subject: 'user-md',
  email: 'maryna@example.com',
  displayName: 'Maryna D.',
  initials: 'MD',
  roleLabel: 'Test Lead',
  status: 'ACTIVE',
  programmeId: PROGRAMME_ID,
  roles: ['TEAM_LEAD', 'LEADERSHIP'],
  assignedTeamIds: ASSIGNED_TEAM_IDS,
  canViewAll: true,
};

/** The full reference dataset written into the document store on startup. */
export interface ReferenceData {
  programmes: Programme[];
  streams: Stream[];
  teams: Team[];
  sprints: Sprint[];
  checkpoints: ReportingCheckpoint[];
}

/** Build the reference dataset seeded into the store (design.md §4a). */
export function buildReferenceData(): ReferenceData {
  return {
    programmes: [PROGRAMME],
    streams: STREAMS,
    teams: TEAMS,
    sprints: SPRINTS,
    checkpoints: CHECKPOINTS,
  };
}
