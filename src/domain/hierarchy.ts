/**
 * Programme hierarchy domain types: Programme -> Stream -> Team, plus the
 * reporting-cycle types Sprint -> ReportingCheckpoint (Week 1 / Week 2).
 *
 * The concrete VSDD values live in api/seed.ts as *seed data*, never as
 * hard-coded business rules (requirements.md §4).
 */

export interface Programme {
  id: string;
  name: string;
  active: boolean;
}

export interface Stream {
  id: string;
  programmeId: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface Team {
  id: string;
  streamId: string;
  name: string;
  sortOrder: number;
  active: boolean;
  archivedAt?: string;
}

export type SprintStatus = 'PLANNED' | 'CURRENT' | 'CLOSED';

export interface Sprint {
  id: string;
  programmeId: string;
  label: string;
  startDate: string; // ISO date (UTC)
  endDate: string; // ISO date (UTC)
  status: SprintStatus;
}

export type CheckpointStatus = 'UPCOMING' | 'CURRENT' | 'CLOSED';

export interface ReportingCheckpoint {
  id: string;
  sprintId: string;
  weekNumber: 1 | 2;
  opensAt: string; // ISO datetime (UTC)
  dueAt: string; // ISO datetime (UTC)
  closesAt: string; // ISO datetime (UTC)
  status: CheckpointStatus;
}

/** A team enriched with its owning stream id, used by flat lookups and filters. */
export interface TeamWithStream extends Team {
  streamName: string;
}

/** Resolved hierarchy tree returned by the repository for Leadership View. */
export interface HierarchyTree {
  programme: Programme;
  streams: Array<{
    stream: Stream;
    teams: Team[];
  }>;
}
