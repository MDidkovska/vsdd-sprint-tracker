/**
 * Vendor-neutral document repository contract (the persistence boundary).
 *
 * This is the ONLY persistence abstraction the domain/API layers may depend on.
 * MongoDB-specific code lives exclusively in the adapter that implements this
 * interface (`mongoDocumentRepository.ts`); nothing here mentions MongoDB
 * (design.md §4b vendor-neutral boundary).
 *
 * The contract expresses exactly the §4a guarantees the PoC needs:
 *  - the mutable draft aggregate is written under an optimistic-concurrency
 *    (`revision`/ETag) guard — a stale revision returns a conflict and
 *    overwrites nothing;
 *  - submitted versions and audit events are append-only and immutable.
 *
 * Task 7.3 adds the read-only reference/config primitives (programme hierarchy
 * and reporting cycle) plus an idempotent reference seed. Tasks 7.5/7.6 add the
 * atomic submit and reopen primitives. The remaining business operations
 * (leadership projections, decisions, export …) are still deliberately NOT part
 * of this contract — they are later tasks (7.7–7.11). This interface is the
 * storage primitive those endpoints build on.
 */
import type {
  AuditAction,
  AuditEvent,
  LeadershipDecision,
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
import type { Notification } from '../domain/notifications.js';
import type { ReferenceData } from '../reference/referenceData.js';

/**
 * Result of an optimistic write. On conflict the store returns its current
 * envelope snapshot (mirrors `WriteOutcome` in the frontend persistence model).
 */
export type WriteOutcome<TDoc> =
  | { ok: true; document: TDoc }
  | {
      ok: false;
      conflict: true;
      server: { revision: number; updatedAt: string; updatedBy: string };
    };

/**
 * A draft write: the desired next document state plus the revision the client
 * last read. The store rejects the write when the stored revision differs.
 */
export interface SaveDraftInput {
  /**
   * The full draft document the client wants to persist. Its `revision` field
   * is ignored for the guard; {@link expectedRevision} is authoritative. On
   * success the stored document's revision becomes `expectedRevision + 1`.
   */
  document: Omit<UpdateDocument, 'revision'>;
  /** Revision the client believes is current (0 when creating a new draft). */
  expectedRevision: number;
}

/**
 * An atomic submit (task 7.5). The store must, as a single indivisible unit
 * (design.md §4a atomicity guarantee):
 *  1. transition the mutable draft to its SUBMITTED envelope under the
 *     optimistic-concurrency guard (a stale revision creates nothing), and
 *  2. append the immutable {@link UpdateVersion} snapshot, and
 *  3. append the {@link AuditEvent}.
 *
 * If any step fails the whole operation is rolled back — no partial version or
 * audit document is left behind.
 */
export interface SubmitDraftInput {
  /**
   * The SUBMITTED draft envelope to store. Its `revision` field is ignored for
   * the guard; {@link expectedRevision} is authoritative and the stored
   * document's revision becomes `expectedRevision + 1`.
   */
  document: Omit<UpdateDocument, 'revision'>;
  /** The immutable submitted snapshot to append (never mutated afterwards). */
  version: UpdateVersion;
  /** The append-only audit document recording the submission. */
  audit: AuditEvent;
  /** Revision the client believes is current (0 when submitting a fresh draft). */
  expectedRevision: number;
}

/**
 * Result of an atomic submit. On success it returns the stored SUBMITTED
 * document (revision incremented) and the appended version. On a stale revision
 * it returns the current server envelope and creates nothing.
 */
export type SubmitOutcome =
  | { ok: true; document: UpdateDocument; version: UpdateVersion }
  | {
      ok: false;
      conflict: true;
      server: { revision: number; updatedAt: string; updatedBy: string };
    };

/**
 * An atomic authorised reopen (task 7.6). The store must, as a single
 * indivisible unit (design.md §4a atomicity guarantee):
 *  1. transition the mutable draft from its SUBMITTED envelope to a new editable
 *     REOPENED envelope under the optimistic-concurrency guard (a stale revision
 *     transitions nothing), and
 *  2. append the {@link AuditEvent} recording the reopen (actor, timestamp,
 *     reason, previous and new version).
 *
 * The latest submitted {@link UpdateVersion} is NEVER mutated or deleted — it
 * remains immutable and visible (R11.4). If any step fails the whole operation
 * is rolled back so no orphan audit document is left behind.
 */
export interface ReopenUpdateInput {
  /**
   * The REOPENED draft envelope to store. Its `revision` field is ignored for
   * the guard; {@link expectedRevision} is authoritative and the stored
   * document's revision becomes `expectedRevision + 1`.
   */
  document: Omit<UpdateDocument, 'revision'>;
  /** The append-only audit document recording the reopen. */
  audit: AuditEvent;
  /** Revision the client believes is current (0 when no draft doc exists yet). */
  expectedRevision: number;
}

/**
 * Result of an atomic reopen. On success it returns the stored REOPENED
 * document (revision incremented). On a stale revision it returns the current
 * server envelope and transitions nothing.
 */
export type ReopenOutcome =
  | { ok: true; document: UpdateDocument }
  | {
      ok: false;
      conflict: true;
      server: { revision: number; updatedAt: string; updatedBy: string };
    };

/**
 * A leadership projection query over the mutable draft aggregates (task 7.7).
 * Filtering uses ONLY the stable query-envelope fields (design.md §4a schema-
 * version strategy) so it never depends on reaching into an arbitrary payload
 * shape and is served by the `ix_update_leadership` index.
 */
export interface UpdateQuery {
  programmeId: string;
  sprintId?: string;
  checkpointId?: string;
  streamId?: string;
}

/**
 * An atomic leadership-decision recording (task 7.9). The store must, as a
 * single indivisible unit (design.md §4a atomicity guarantee):
 *  1. append the immutable {@link LeadershipDecision} document, and
 *  2. append the {@link AuditEvent} recording the decision (actor, timestamp,
 *     action DECISION_RECORDED, entity id).
 *
 * Recording a decision NEVER touches the referenced {@link UpdateVersion} or
 * the team's original leadership ask (R10.3) — both stay immutable. If either
 * append fails the whole operation is rolled back so no orphan decision or
 * audit document is left behind (R14.1, R14.2, R14.4).
 */
export interface RecordDecisionInput {
  /** The append-only decision document to store (never mutated afterwards). */
  decision: LeadershipDecision;
  /** The append-only audit document recording the decision. */
  audit: AuditEvent;
}

/**
 * A filtered, paginated audit-history query (Phase 8 repair, persisted admin
 * audit endpoint). Filters use only stable envelope fields (never payload):
 *  - `userId`   matches the stable per-user aggregate key (`aggregateId`);
 *  - `entityId` matches the specific entity the event is about;
 *  - `action`   matches a single audit action.
 * Results are newest-first; `limit`/`offset` page the result set.
 */
export interface AuditQuery {
  userId?: string;
  entityId?: string;
  action?: AuditAction;
  limit: number;
  offset: number;
}

/** A page of audit events plus the total count matching the filter. */
export interface AuditPageResult {
  events: AuditEvent[];
  total: number;
}

export interface DocumentRepository {
  /**
   * Readiness probe: verifies the underlying store is reachable. Returns true
   * when a round-trip succeeds; throws or returns false otherwise. Used by the
   * `/ready` endpoint — never touches business data.
   */
  ping(): Promise<boolean>;

  // --- reference / config reads (design.md §4a, task 7.3) ------------------

  /**
   * Idempotently write the reference/config dataset (programme, streams, teams,
   * sprints, checkpoints). Re-running is safe — existing documents are upserted
   * by their stable id, never duplicated. Used on startup and in tests.
   */
  seedReferenceData(data: ReferenceData): Promise<void>;

  /** Read a programme by id, or null when it does not exist. */
  getProgramme(programmeId: string): Promise<Programme | null>;

  /** List a programme's streams (caller decides ordering/filtering). */
  listStreams(programmeId: string): Promise<Stream[]>;

  /** List a programme's teams across all of its streams. */
  listTeams(programmeId: string): Promise<Team[]>;

  /** List a programme's sprints (the reporting cycle). */
  listSprints(programmeId: string): Promise<Sprint[]>;

  /** Read a single sprint by id, or null when it does not exist. */
  getSprint(sprintId: string): Promise<Sprint | null>;

  /** List the reporting checkpoints (Week 1 / Week 2) for a sprint. */
  listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]>;

  /** Read a single team by id, or null when it does not exist. */
  getTeam(teamId: string): Promise<Team | null>;

  /** Read a single stream by id, or null when it does not exist. */
  getStream(streamId: string): Promise<Stream | null>;

  /** Read a single reporting checkpoint by id, or null when it does not exist. */
  getCheckpoint(checkpointId: string): Promise<ReportingCheckpoint | null>;

  // --- reference / config admin writes (design.md §4a, task 9.5) -----------
  //
  // Programme hierarchy and reporting cycle are configurable seed/admin values,
  // not hard-coded rules (requirements.md §4, R17.1). These primitives let the
  // Programme-Admin service create/update streams and teams and configure
  // sprints/checkpoints WITHOUT a code deployment. They are reference/config
  // documents — never the immutable submitted versions or audit events — so a
  // stream/team/sprint/checkpoint upsert is an ordinary keyed write, and team
  // archival (task 9.6) never removes prior versions (R17.2, R17.4). All
  // validation (unique team name within a stream, exactly two weekly
  // checkpoints, programme scoping) lives in the service; these are the neutral
  // storage primitives it builds on.

  /**
   * Atomically create/update a stream AND append its audit event as ONE unit
   * (design.md §4a). Both writes commit together or roll back together, so a
   * hierarchy change never leaves a config document without its audit record,
   * and never uses sequential independent writes (R17).
   */
  saveStreamWithAudit(stream: Stream, audit: AuditEvent): Promise<Stream>;

  /**
   * Atomically create/update a team AND append its audit event as ONE unit
   * (design.md §4a). Both writes commit together or roll back together.
   */
  saveTeamWithAudit(team: Team, audit: AuditEvent): Promise<Team>;

  /**
   * Atomically insert a NEW sprint, its (two) weekly checkpoints AND the audit
   * event as a single indivisible unit (R2.1, design.md §4a). The sprint id must
   * not already exist — a duplicate is rejected so a sprint is never silently
   * overwritten. If any write fails the whole unit rolls back, leaving no partial
   * sprint/checkpoints and no orphan audit event.
   */
  createSprint(
    sprint: Sprint,
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }>;

  /**
   * Atomically upsert one or more checkpoints AND append the audit event as a
   * single indivisible unit, for reporting-window transitions (set-current,
   * close, reopen). A set-current touches more than one checkpoint (promote the
   * target, demote the previously current one), so the "exactly one CURRENT"
   * invariant is never observable as multiple/zero CURRENT: every write commits
   * together or rolls back together, leaving no orphan audit event (R2.2/R2.3).
   */
  saveCheckpointsWithAudit(
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<ReportingCheckpoint[]>;

  // --- update aggregate + append-only stores -------------------------------

  /** Read the current mutable draft aggregate by its deterministic id. */
  getDraft(id: string): Promise<UpdateDocument | null>;

  /**
   * List the mutable draft aggregates matching a leadership projection query
   * (task 7.7). Filters on stable query-envelope fields only (programme, sprint,
   * checkpoint, stream). Used to resolve each team's current-checkpoint state
   * for the leadership summary / filtered hierarchy projection (R12, R13).
   */
  listUpdates(query: UpdateQuery): Promise<UpdateDocument[]>;

  /**
   * List every submitted immutable version for a programme, newest version
   * first (task 7.7). Used to derive the STALE fallback: when a team has no
   * submission at the current checkpoint, the latest earlier submission is shown
   * and marked stale — never counted as current evidence (R12.4, design.md §5).
   */
  listVersionsForProgramme(programmeId: string): Promise<UpdateVersion[]>;

  /**
   * Persist the mutable draft under the optimistic-concurrency guard. Returns
   * `{ ok: true }` with the stored document (revision incremented) or
   * `{ ok: false, conflict: true }` with the current server metadata. Never
   * performs a silent last-write-wins overwrite (R11.5).
   */
  saveDraft(input: SaveDraftInput): Promise<WriteOutcome<UpdateDocument>>;

  /**
   * Atomically submit a draft (task 7.5): transition the draft to SUBMITTED
   * under the optimistic-concurrency guard, append the immutable version and
   * append the audit event — all or nothing. A stale revision returns a
   * conflict and creates nothing (R11.2, R11.3, R14.1, R14.2, R14.4).
   */
  submitUpdate(input: SubmitDraftInput): Promise<SubmitOutcome>;

  /**
   * Atomically reopen a submitted update (task 7.6): transition the draft from
   * SUBMITTED to a new editable REOPENED envelope under the optimistic-
   * concurrency guard and append the reopen audit event — all or nothing. The
   * latest submitted immutable version is never mutated or deleted. A stale
   * revision returns a conflict and transitions nothing (R2.3, R11.3, R11.4,
   * R14.1, R14.2).
   */
  reopenUpdate(input: ReopenUpdateInput): Promise<ReopenOutcome>;

  /**
   * Append an immutable submitted snapshot. Inserting a document whose id
   * already exists is an immutability violation and must be rejected — existing
   * versions are never mutated (R2.2, R11.2, R14.1).
   */
  appendVersion(version: UpdateVersion): Promise<UpdateVersion>;

  /** Read a submitted version by id. */
  getVersion(id: string): Promise<UpdateVersion | null>;

  /** List submitted versions for a team + checkpoint, newest first. */
  listVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]>;

  /**
   * Append an audit document. Audit data is append-only to application users;
   * re-inserting the same id is rejected (R14.2, R14.4).
   */
  appendAudit(event: AuditEvent): Promise<AuditEvent>;

  /** Read audit documents for a single entity id, chronological (oldest first). */
  listAudit(entityId: string): Promise<AuditEvent[]>;

  /**
   * Query the persisted audit history with optional filters, newest-first, paged
   * (Phase 8 repair). Backs the read-only admin/auditor audit endpoint. Returns
   * the page plus the total count so the client can paginate.
   */
  queryAudit(query: AuditQuery): Promise<AuditPageResult>;

  /**
   * Read the COMPLETE audit trail for an update aggregate, newest first. Every
   * lifecycle event for one update (submit, reopen, resubmit, leadership
   * decision) shares the stable `aggregateId` (`${teamId}|${sprintId}|
   * ${checkpointId}`), so this returns the unified history the audit endpoint
   * serves — regardless of the differing per-event `entityId`s. Ordering is
   * strictly newest-first and deterministic (design.md §6 / OpenAPI).
   */
  listAuditForAggregate(aggregateId: string): Promise<AuditEvent[]>;

  // --- leadership decisions (append-only, task 7.9) ------------------------

  /**
   * Atomically record a leadership decision (task 7.9): append the immutable
   * decision document and the audit event — all or nothing. The referenced
   * submitted version and the team's original ask are never mutated (R10.3).
   * Re-inserting the same decision id is an immutability violation and is
   * rejected (R14.1, R14.2, R14.4).
   */
  recordDecision(input: RecordDecisionInput): Promise<LeadershipDecision>;

  /** Read a leadership decision by id, or null when it does not exist. */
  getDecision(id: string): Promise<LeadershipDecision | null>;

  /**
   * List leadership decisions recorded against a submitted version, oldest
   * first (chronological). Filtering uses only the stable `updateVersionId`.
   */
  listDecisions(versionId: string): Promise<LeadershipDecision[]>;

  // --- in-app notifications (Phase 9, task 9.1) ---------------------------

  /**
   * Insert a notification only when its stable id does not already exist.
   * Returns true when a new document was written, false when one already
   * existed. This primitive is what makes lazy reminder generation IDEMPOTENT —
   * repeated inbox loads never create duplicates (task 9.1).
   */
  insertNotificationIfAbsent(notification: Notification): Promise<boolean>;

  /**
   * List a single recipient's notifications, newest first. Filtering is by the
   * stable `recipientSubject` only, so a recipient can never read another
   * user's notifications (recipient isolation, task 9.1).
   */
  listNotificationsForRecipient(recipientSubject: string): Promise<Notification[]>;

  /** Read a notification by id, or null when it does not exist. */
  getNotification(id: string): Promise<Notification | null>;

  /**
   * Mark a notification read for a specific recipient. The recipient guard is
   * part of the update, so marking is scoped to the caller's own notifications
   * and returns null when the id does not belong to them.
   */
  markNotificationRead(
    id: string,
    recipientSubject: string,
    readAt: string,
  ): Promise<Notification | null>;

  /** Mark every unread notification for a recipient read; returns the count. */
  markAllNotificationsRead(recipientSubject: string, readAt: string): Promise<number>;

  /** Release underlying resources (connection pool). */
  close(): Promise<void>;
}
