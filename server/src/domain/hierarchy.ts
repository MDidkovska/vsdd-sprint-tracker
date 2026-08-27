/**
 * Programme-hierarchy and reporting-cycle domain shapes for the PoC backend.
 *
 * These MIRROR the frontend domain contract (`src/domain/hierarchy.ts`) and the
 * OpenAPI 3.1 component schemas (task 7.1) so a hierarchy tree or sprint list
 * produced by this backend is structurally identical to what the frontend mock
 * repository already returns. The backend is a separate package, so the shapes
 * are re-declared here rather than imported — but they must stay structurally
 * identical across the boundary (design.md §4, §4a).
 *
 * These are read-only reference/config shapes (design.md §4a "Reference/config
 * documents for hierarchy, sprints, checkpoints and assignments").
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

/** Resolved hierarchy tree: Programme -> Stream -> Team (design.md §6). */
export interface HierarchyTree {
  programme: Programme;
  streams: Array<{
    stream: Stream;
    teams: Team[];
  }>;
}
