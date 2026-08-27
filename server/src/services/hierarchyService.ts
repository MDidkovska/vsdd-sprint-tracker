/**
 * Hierarchy and reporting-cycle read service (task 7.3).
 *
 * This is the vendor-neutral business layer behind the read endpoints. It
 * depends only on the repository *contract* (a narrow read port) and the
 * mocked auth context — never on MongoDB (design.md §4b vendor-neutral
 * boundary). It:
 *
 *  - resolves the authenticated subject for `/me` (R3 team context);
 *  - assembles the Programme -> Stream -> Team tree for `/hierarchy`
 *    (R12 leadership hierarchy), returning only active streams/teams in
 *    `sortOrder`;
 *  - lists a programme's sprints for `/sprints`, optionally filtered by status
 *    (R2 reporting-cycle configuration).
 *
 * A missing programme is reported as a NOT_FOUND ApiError so the route can
 * return the §6 error envelope with a 404.
 */
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import type {
  HierarchyTree,
  Programme,
  ReportingCheckpoint,
  Sprint,
  SprintStatus,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import { assertProgrammeMember } from '../auth/authorization.js';
import { ApiError } from '../http/errorEnvelope.js';

/**
 * The narrow slice of the repository this service needs. Declaring it here (not
 * importing the full {@link DocumentRepository}) keeps the service decoupled
 * from write/append concerns and trivially fakeable in unit tests.
 */
export interface HierarchyReadPort {
  getProgramme(programmeId: string): Promise<Programme | null>;
  listStreams(programmeId: string): Promise<Stream[]>;
  listTeams(programmeId: string): Promise<Team[]>;
  listSprints(programmeId: string): Promise<Sprint[]>;
  listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]>;
}

/** Public read API consumed by the HTTP routes. */
export interface HierarchyApi {
  getCurrentUser(): Promise<CurrentUser>;
  getHierarchy(programmeId: string): Promise<HierarchyTree>;
  getSprints(programmeId: string, status?: SprintStatus): Promise<Sprint[]>;
}

/** Map the lowercase OpenAPI `status` query value to the domain enum. */
const STATUS_BY_QUERY: Record<string, SprintStatus> = {
  current: 'CURRENT',
  planned: 'PLANNED',
  closed: 'CLOSED',
};

/**
 * Parse and validate the optional `status` query value. Returns undefined when
 * absent (no filter) and throws VALIDATION_FAILED for an unrecognised value.
 */
export function parseSprintStatus(raw: string | undefined): SprintStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  const mapped = STATUS_BY_QUERY[raw.toLowerCase()];
  if (!mapped) {
    throw ApiError.validation(
      'Unknown sprint status filter. Use one of: current, planned, closed.',
      [{ path: 'status', message: 'Must be current, planned or closed.' }],
    );
  }
  return mapped;
}

export class HierarchyService implements HierarchyApi {
  private readonly repository: HierarchyReadPort;
  private readonly auth: AuthContext;

  constructor(repository: HierarchyReadPort, auth: AuthContext) {
    this.repository = repository;
    this.auth = auth;
  }

  async getCurrentUser(): Promise<CurrentUser> {
    return this.auth.getCurrentUser();
  }

  async getHierarchy(programmeId: string): Promise<HierarchyTree> {
    // Programme-scoped: only an ACTIVE member of THIS programme may read it.
    assertProgrammeMember(this.auth.getCurrentUser(), programmeId);
    const programme = await this.assertProgramme(programmeId);

    const [streams, teams] = await Promise.all([
      this.repository.listStreams(programmeId),
      this.repository.listTeams(programmeId),
    ]);

    const orderedStreams = [...streams]
      .filter((stream) => stream.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      programme,
      streams: orderedStreams.map((stream) => ({
        stream,
        teams: teams
          .filter((team) => team.streamId === stream.id && team.active)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      })),
    };
  }

  async getSprints(programmeId: string, status?: SprintStatus): Promise<Sprint[]> {
    assertProgrammeMember(this.auth.getCurrentUser(), programmeId);
    await this.assertProgramme(programmeId);
    const sprints = await this.repository.listSprints(programmeId);
    const filtered = status ? sprints.filter((s) => s.status === status) : sprints;
    // Chronological by start date keeps the reporting cycle predictable.
    return [...filtered].sort((a, b) => a.startDate.localeCompare(b.startDate));
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
