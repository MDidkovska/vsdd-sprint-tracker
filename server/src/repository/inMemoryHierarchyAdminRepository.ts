/**
 * In-memory reference/config repository for the hierarchy-admin workflows
 * (Phase 9, task 9.5), used by the atomic-rollback tests.
 *
 * It implements the {@link HierarchyAdminRepository} port with GENUINE
 * staged-commit rollback that mirrors the Mongo transactions: each atomic write
 * stages its config mutation(s) with an undo stack and checks
 * {@link injectedFailure} at the mid-transaction point (after the config writes,
 * before the audit append). A thrown failure runs the undo stack in reverse, so
 * NOTHING is left partially written — no partial sprint/checkpoints, no
 * multiple/zero CURRENT state and no orphan audit event. The real Mongo adapter
 * gets the same guarantee from a real transaction.
 */
import type { AuditEvent } from '../domain/documents.js';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import { DuplicateKeyError } from './errors.js';
import type { HierarchyAdminRepository } from '../services/hierarchyAdminService.js';

export class InMemoryHierarchyAdminRepository implements HierarchyAdminRepository {
  readonly programmes = new Map<string, Programme>();
  readonly streams = new Map<string, Stream>();
  readonly teams = new Map<string, Team>();
  readonly sprints = new Map<string, Sprint>();
  readonly checkpoints = new Map<string, ReportingCheckpoint>();
  readonly auditEvents: AuditEvent[] = [];

  /** Test hook: when set, the NEXT atomic op throws at its mid-transaction point. */
  injectedFailure: Error | null = null;

  private failpoint(): void {
    if (this.injectedFailure) {
      const error = this.injectedFailure;
      this.injectedFailure = null;
      throw error;
    }
  }

  // --- reads ---------------------------------------------------------------

  async getProgramme(programmeId: string): Promise<Programme | null> {
    return this.programmes.get(programmeId) ?? null;
  }
  async getStream(streamId: string): Promise<Stream | null> {
    return this.streams.get(streamId) ?? null;
  }
  async getTeam(teamId: string): Promise<Team | null> {
    return this.teams.get(teamId) ?? null;
  }
  async listTeams(programmeId: string): Promise<Team[]> {
    const streamIds = new Set(
      [...this.streams.values()].filter((s) => s.programmeId === programmeId).map((s) => s.id),
    );
    return [...this.teams.values()].filter((t) => streamIds.has(t.streamId));
  }
  async getSprint(sprintId: string): Promise<Sprint | null> {
    return this.sprints.get(sprintId) ?? null;
  }
  async getCheckpoint(checkpointId: string): Promise<ReportingCheckpoint | null> {
    return this.checkpoints.get(checkpointId) ?? null;
  }
  async listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]> {
    return [...this.checkpoints.values()].filter((c) => c.sprintId === sprintId);
  }

  // --- atomic writes (staged-commit, mirroring the Mongo transactions) -----

  async saveStreamWithAudit(stream: Stream, audit: AuditEvent): Promise<Stream> {
    const undo: Array<() => void> = [];
    try {
      const prior = this.streams.get(stream.id);
      this.streams.set(stream.id, { ...stream });
      undo.push(() =>
        prior ? this.streams.set(stream.id, prior) : this.streams.delete(stream.id),
      );
      this.failpoint();
      this.auditEvents.push({ ...audit });
      undo.push(() => this.auditEvents.pop());
      return stream;
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }

  async saveTeamWithAudit(team: Team, audit: AuditEvent): Promise<Team> {
    const undo: Array<() => void> = [];
    try {
      const prior = this.teams.get(team.id);
      this.teams.set(team.id, { ...team });
      undo.push(() => (prior ? this.teams.set(team.id, prior) : this.teams.delete(team.id)));
      this.failpoint();
      this.auditEvents.push({ ...audit });
      undo.push(() => this.auditEvents.pop());
      return team;
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }

  async createSprint(
    sprint: Sprint,
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }> {
    if (this.sprints.has(sprint.id)) {
      throw new DuplicateKeyError(`A sprint with id "${sprint.id}" already exists.`);
    }
    const undo: Array<() => void> = [];
    try {
      this.sprints.set(sprint.id, { ...sprint });
      undo.push(() => this.sprints.delete(sprint.id));
      for (const cp of checkpoints) {
        const prior = this.checkpoints.get(cp.id);
        this.checkpoints.set(cp.id, { ...cp });
        undo.push(() =>
          prior ? this.checkpoints.set(cp.id, prior) : this.checkpoints.delete(cp.id),
        );
      }
      this.failpoint();
      this.auditEvents.push({ ...audit });
      undo.push(() => this.auditEvents.pop());
      return { sprint, checkpoints };
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }

  async saveCheckpointsWithAudit(
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<ReportingCheckpoint[]> {
    const undo: Array<() => void> = [];
    try {
      for (const cp of checkpoints) {
        const prior = this.checkpoints.get(cp.id);
        this.checkpoints.set(cp.id, { ...cp });
        undo.push(() =>
          prior ? this.checkpoints.set(cp.id, prior) : this.checkpoints.delete(cp.id),
        );
      }
      this.failpoint();
      this.auditEvents.push({ ...audit });
      undo.push(() => this.auditEvents.pop());
      return checkpoints;
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }
}
