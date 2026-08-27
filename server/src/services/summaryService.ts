/**
 * Leadership summary and filtered hierarchy projection service (task 7.7).
 *
 * The vendor-neutral business layer behind the leadership read endpoint
 * (design.md §6):
 *   GET /api/v1/programmes/{programmeId}/reporting-summary
 *       ?sprintId=&checkpointId=&streamId=&rag=&state=
 *
 * Leadership View is a *projection* of submitted Team Update data — it never
 * stores a second copy (design.md §1). This service:
 *
 *  - assembles the Programme -> Stream -> Team tree for a chosen sprint +
 *    checkpoint, resolving each team's cell state (R12.1, R12.2);
 *  - keeps Draft / Missing / Stale / Reopened explicit and NEVER treats them as
 *    submitted evidence — a Missing cell carries a null RAG so it can never read
 *    as a false Green (R12.4, design.md §5);
 *  - derives STALE from the latest earlier submission when the current
 *    checkpoint has no submission of its own (design.md §5);
 *  - applies the stream / RAG / update-state filters against the stable query
 *    envelope and recalculates the summary counts against the *filtered*
 *    population, stating the active reporting period (R13.1–R13.3);
 *  - returns the filtered snapshot even when it is empty, so the client can show
 *    the "no teams match" reset-filters state (R13.4).
 *
 * Like the other read services, it depends only on a narrow repository *port*
 * and never on MongoDB (design.md §4b vendor-neutral boundary).
 */
import type {
  RagStatuses,
  UpdateDocument,
  UpdateVersion,
} from '../domain/documents.js';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import type {
  LeadershipFilters,
  LeadershipStreamGroup,
  LeadershipTeamCell,
  RagFilter,
  ReportingSummary,
  ResolvedUpdate,
  StateFilter,
} from '../domain/leadership.js';
import { applyFilters, computeSummary } from '../domain/leadershipFiltering.js';
import type { AuthContext } from '../auth/mockAuth.js';
import { assertCanViewProgramme } from '../auth/authorization.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { UpdateQuery } from '../repository/documentRepository.js';

/**
 * The narrow slice of the repository the leadership projection needs. Declaring
 * it here keeps the service decoupled from write concerns and trivially fakeable
 * in unit tests.
 */
export interface SummaryReadPort {
  getProgramme(programmeId: string): Promise<Programme | null>;
  listStreams(programmeId: string): Promise<Stream[]>;
  listTeams(programmeId: string): Promise<Team[]>;
  listSprints(programmeId: string): Promise<Sprint[]>;
  getSprint(sprintId: string): Promise<Sprint | null>;
  listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]>;
  getCheckpoint(checkpointId: string): Promise<ReportingCheckpoint | null>;
  listUpdates(query: UpdateQuery): Promise<UpdateDocument[]>;
  listVersionsForProgramme(programmeId: string): Promise<UpdateVersion[]>;
}

/** The raw query values from the HTTP layer (before validation). */
export interface ReportingSummaryQuery {
  sprintId?: string;
  checkpointId?: string;
  streamId?: string;
  rag?: string;
  state?: string;
}

/** Public API consumed by the HTTP route. */
export interface SummaryApi {
  getReportingSummary(
    programmeId: string,
    query: ReportingSummaryQuery,
  ): Promise<ReportingSummary>;
}

const RAG_FILTER_VALUES: readonly RagFilter[] = ['ALL', 'GREEN', 'AMBER', 'RED'];
const STATE_FILTER_VALUES: readonly StateFilter[] = [
  'ALL',
  'MISSING',
  'DRAFT',
  'SUBMITTED',
  'REOPENED',
  'STALE',
];

/** Parse and validate the optional `rag` filter (defaults to ALL). */
export function parseRagFilter(raw: string | undefined): RagFilter {
  if (raw === undefined || raw === '') return 'ALL';
  const upper = raw.toUpperCase();
  if (!RAG_FILTER_VALUES.includes(upper as RagFilter)) {
    throw ApiError.validation(
      'Unknown RAG filter. Use one of: ALL, GREEN, AMBER, RED.',
      [{ path: 'rag', message: 'Must be ALL, GREEN, AMBER or RED.' }],
    );
  }
  return upper as RagFilter;
}

/** Parse and validate the optional `state` filter (defaults to ALL). */
export function parseStateFilter(raw: string | undefined): StateFilter {
  if (raw === undefined || raw === '') return 'ALL';
  const upper = raw.toUpperCase();
  if (!STATE_FILTER_VALUES.includes(upper as StateFilter)) {
    throw ApiError.validation(
      'Unknown update-state filter. Use one of: ALL, MISSING, DRAFT, SUBMITTED, REOPENED, STALE.',
      [{ path: 'state', message: 'Must be ALL, MISSING, DRAFT, SUBMITTED, REOPENED or STALE.' }],
    );
  }
  return upper as StateFilter;
}

export class SummaryService implements SummaryApi {
  private readonly repository: SummaryReadPort;
  private readonly auth: AuthContext;

  constructor(repository: SummaryReadPort, auth: AuthContext) {
    this.repository = repository;
    this.auth = auth;
  }

  async getReportingSummary(
    programmeId: string,
    query: ReportingSummaryQuery,
  ): Promise<ReportingSummary> {
    // Leadership/Admin/Auditor, scoped to THIS programme (R1 matrix).
    assertCanViewProgramme(this.auth.getCurrentUser(), programmeId);
    const programme = await this.assertProgramme(programmeId);

    // sprintId and checkpointId are required (OpenAPI getReportingSummary). A
    // missing value is a 400 with a per-field error.
    const sprintId = query.sprintId?.trim() ?? '';
    const checkpointId = query.checkpointId?.trim() ?? '';
    const missing = [
      sprintId === '' ? { path: 'sprintId', message: 'A sprintId is required.' } : null,
      checkpointId === '' ? { path: 'checkpointId', message: 'A checkpointId is required.' } : null,
    ].filter((e): e is { path: string; message: string } => e !== null);
    if (missing.length > 0) {
      throw ApiError.validation('The reporting cycle is required.', missing);
    }

    const filters: LeadershipFilters = {
      streamId: query.streamId?.trim() ? query.streamId.trim() : 'ALL',
      rag: parseRagFilter(query.rag),
      state: parseStateFilter(query.state),
    };

    // Resolve and validate the reporting cycle. The checkpoint must belong to
    // the sprint, which must belong to the programme.
    const sprint = await this.repository.getSprint(sprintId);
    if (!sprint || sprint.programmeId !== programmeId) {
      throw ApiError.notFound(`Sprint "${sprintId}" was not found in this programme.`);
    }
    const checkpoint = await this.repository.getCheckpoint(checkpointId);
    if (!checkpoint || checkpoint.sprintId !== sprintId) {
      throw ApiError.notFound(
        `Reporting checkpoint "${checkpointId}" was not found in sprint "${sprintId}".`,
      );
    }

    // Load the working set for the projection:
    //  - active streams/teams in sort order (R12.1);
    //  - the current-checkpoint drafts/submissions (envelope-only filter);
    //  - every submitted version + all checkpoints, to derive the STALE fallback.
    const [streams, teams, currentUpdates, versions, checkpointsById] = await Promise.all([
      this.repository.listStreams(programmeId),
      this.repository.listTeams(programmeId),
      this.repository.listUpdates({ programmeId, sprintId, checkpointId }),
      this.repository.listVersionsForProgramme(programmeId),
      this.buildCheckpointIndex(programmeId),
    ]);

    const currentByTeam = new Map<string, UpdateDocument>(
      currentUpdates.map((doc) => [doc.teamId, doc]),
    );
    const versionsByTeam = groupVersionsByTeam(versions);

    const orderedStreams = [...streams]
      .filter((stream) => stream.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const allGroups: LeadershipStreamGroup[] = orderedStreams.map((stream) => ({
      stream,
      teams: teams
        .filter((team) => team.streamId === stream.id && team.active)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map<LeadershipTeamCell>((team) => ({
          team,
          streamId: stream.id,
          resolved: this.resolveForLeadership(
            currentByTeam.get(team.id),
            versionsByTeam.get(team.id) ?? [],
            checkpoint,
            checkpointsById,
          ),
        })),
    }));

    const reportingPeriodLabel = `${sprint.label} · Week ${checkpoint.weekNumber}`;

    // Filters update the tree and the programme counts together (R13.2): both
    // are computed against the same filtered population. An empty result is
    // returned as-is so the client can show the reset-filters zero state (R13.4).
    const filteredGroups = applyFilters({ programme, sprint, checkpoint, streams: allGroups }, filters);
    const summary = computeSummary(filteredGroups, reportingPeriodLabel);

    return {
      summary,
      snapshot: { programme, sprint, checkpoint, streams: filteredGroups },
      filters,
    };
  }

  /**
   * Resolve the content Leadership View should display for one team at the
   * chosen checkpoint, including the derived STALE fallback. Mirrors the
   * frontend mock's `resolveForLeadership` so both sides project identically.
   */
  private resolveForLeadership(
    currentDoc: UpdateDocument | undefined,
    teamVersions: UpdateVersion[],
    checkpoint: ReportingCheckpoint,
    checkpointsById: Map<string, ReportingCheckpoint>,
  ): ResolvedUpdate {
    if (currentDoc && currentDoc.state === 'SUBMITTED') {
      return {
        cellState: 'SUBMITTED',
        rag: cloneRag(currentDoc.rag),
        hasBlocker: currentDoc.hasBlocker,
        hasLeadershipAsk: currentDoc.hasLeadershipAsk,
        payload: currentDoc.payload,
        sourceCheckpointId: checkpoint.id,
        sourceWeekNumber: checkpoint.weekNumber,
        submittedAt: currentDoc.submittedAt,
        updatedAt: currentDoc.updatedAt,
        isStale: false,
        isSubmittedEvidence: true,
      };
    }

    if (currentDoc && (currentDoc.state === 'DRAFT' || currentDoc.state === 'REOPENED')) {
      // Current-checkpoint work in progress — shown, but NOT leadership evidence.
      return {
        cellState: currentDoc.state,
        rag: cloneRag(currentDoc.rag),
        hasBlocker: currentDoc.hasBlocker,
        hasLeadershipAsk: currentDoc.hasLeadershipAsk,
        payload: currentDoc.payload,
        sourceCheckpointId: checkpoint.id,
        sourceWeekNumber: checkpoint.weekNumber,
        updatedAt: currentDoc.updatedAt,
        isStale: false,
        isSubmittedEvidence: false,
      };
    }

    // Nothing at the current checkpoint: look for the latest earlier submission.
    const earlier = latestEarlierSubmission(teamVersions, checkpoint, checkpointsById);
    if (earlier) {
      const earlierCheckpoint = checkpointsById.get(earlier.checkpointId);
      return {
        cellState: 'STALE',
        rag: cloneRag(earlier.rag),
        hasBlocker: earlier.hasBlocker,
        hasLeadershipAsk: earlier.hasLeadershipAsk,
        payload: earlier.payload,
        sourceCheckpointId: earlier.checkpointId,
        sourceWeekNumber: earlierCheckpoint?.weekNumber ?? null,
        submittedAt: earlier.submittedAt,
        isStale: true,
        isSubmittedEvidence: false, // stale must NOT count as a current submission
      };
    }

    return {
      cellState: 'MISSING',
      rag: null, // no current evidence — never a false Green
      hasBlocker: false,
      hasLeadershipAsk: false,
      payload: null,
      sourceCheckpointId: null,
      sourceWeekNumber: null,
      isStale: false,
      isSubmittedEvidence: false,
    };
  }

  /** Build a checkpointId -> checkpoint index across all the programme's sprints. */
  private async buildCheckpointIndex(
    programmeId: string,
  ): Promise<Map<string, ReportingCheckpoint>> {
    const sprints = await this.repository.listSprints(programmeId);
    const lists = await Promise.all(
      sprints.map((sprint) => this.repository.listCheckpoints(sprint.id)),
    );
    const index = new Map<string, ReportingCheckpoint>();
    for (const checkpoints of lists) {
      for (const checkpoint of checkpoints) {
        index.set(checkpoint.id, checkpoint);
      }
    }
    return index;
  }

  /** Resolve the programme or raise a 404 so callers get the §6 envelope. */
  private async assertProgramme(programmeId: string): Promise<Programme> {
    const programme = await this.repository.getProgramme(programmeId);
    if (!programme) {
      throw ApiError.notFound(`Programme "${programmeId}" was not found.`);
    }
    return programme;
  }
}

/** Group submitted versions by team id (order within a team is preserved). */
function groupVersionsByTeam(versions: UpdateVersion[]): Map<string, UpdateVersion[]> {
  const byTeam = new Map<string, UpdateVersion[]>();
  for (const version of versions) {
    const list = byTeam.get(version.teamId);
    if (list) {
      list.push(version);
    } else {
      byTeam.set(version.teamId, [version]);
    }
  }
  return byTeam;
}

/**
 * Find a team's latest submission from a checkpoint that opened strictly before
 * the current one. Ties on checkpoint open time are broken by the higher
 * version number so a reopened+resubmitted checkpoint wins deterministically.
 */
function latestEarlierSubmission(
  teamVersions: UpdateVersion[],
  currentCheckpoint: ReportingCheckpoint,
  checkpointsById: Map<string, ReportingCheckpoint>,
): UpdateVersion | undefined {
  const before = new Date(currentCheckpoint.opensAt).getTime();
  const earlier = teamVersions.filter((version) => {
    const cp = checkpointsById.get(version.checkpointId);
    return cp ? new Date(cp.opensAt).getTime() < before : false;
  });
  if (earlier.length === 0) return undefined;

  return earlier.sort((a, b) => {
    const ca = checkpointsById.get(a.checkpointId);
    const cb = checkpointsById.get(b.checkpointId);
    const opensDelta =
      new Date(cb?.opensAt ?? 0).getTime() - new Date(ca?.opensAt ?? 0).getTime();
    if (opensDelta !== 0) return opensDelta;
    return b.versionNumber - a.versionNumber;
  })[0];
}

/** Defensive shallow clone so a caller can never mutate stored RAG state. */
function cloneRag(rag: RagStatuses): RagStatuses {
  return { business: rag.business, delivery: rag.delivery, release: rag.release };
}
