/**
 * MongoDB document adapter (PoC only).
 *
 * This is the ONE place in the codebase that knows about MongoDB (design.md
 * §4b). It implements the vendor-neutral {@link DocumentRepository} contract and
 * translates every MongoDB-specific concern — the driver, `_id`, duplicate-key
 * errors, conditional updates — into the neutral contract and error types. The
 * domain and (future) API layers never import the driver.
 *
 * Storage model (design.md §4a):
 *  - `updates`        — one mutable draft aggregate per team/checkpoint,
 *                       written under an optimistic `revision` guard.
 *  - `updateVersions` — immutable, append-only submitted snapshots.
 *  - `auditEvents`    — append-only audit trail.
 *
 * The logical `id` is the aggregate key; a unique index enforces at-most-one
 * document per id. We let MongoDB manage its physical `_id` and strip it on the
 * way out so stored documents map 1:1 to the frontend domain shapes.
 */
import {
  MongoClient,
  type AnyBulkWriteOperation,
  type ClientSession,
  type Collection,
  type Db,
  type Document,
  type Filter,
} from 'mongodb';
import type {
  Assignment,
  AccountStatus,
  SessionRecord,
  UserAccount,
} from '../domain/accounts.js';
import type {
  AuditEvent,
  LeadershipDecision,
  UpdateDocument,
  UpdateVersion,
} from '../domain/documents.js';
import type { Notification } from '../domain/notifications.js';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import type { ReferenceData } from '../reference/referenceData.js';
import type {
  AuditPageResult,
  AuditQuery,
  DocumentRepository,
  RecordDecisionInput,
  ReopenOutcome,
  ReopenUpdateInput,
  SaveDraftInput,
  SubmitDraftInput,
  SubmitOutcome,
  UpdateQuery,
  WriteOutcome,
} from './documentRepository.js';
import { DuplicateKeyError, ImmutableViolationError, RepositoryError } from './errors.js';
import type {
  ApproveUserAtomicInput,
  ChangeStatusAtomicInput,
  CreateAdminAtomicInput,
  CreateUserAtomicInput,
  IdentityRepository,
  UpdateAssignmentAtomicInput,
} from './identityRepository.js';

export interface MongoDocumentRepositoryConfig {
  uri: string;
  dbName: string;
}

const COLLECTIONS = {
  updates: 'updates',
  updateVersions: 'updateVersions',
  auditEvents: 'auditEvents',
  decisions: 'decisions',
  // Reference/config collections (design.md §4a).
  programmes: 'programmes',
  streams: 'streams',
  teams: 'teams',
  sprints: 'sprints',
  checkpoints: 'checkpoints',
  // Local-account identity collections (Phase 8, design.md §5a).
  users: 'users',
  assignments: 'assignments',
  sessions: 'sessions',
  // In-app notifications (Phase 9, task 9.1).
  notifications: 'notifications',
} as const;

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * Internal session storage shape. `expiresAt` is a BSON `Date` (not the domain
 * ISO string) so the TTL index can reap expired sessions; it is mapped back to
 * an ISO string on read to keep the vendor-neutral {@link SessionRecord} shape.
 */
interface StoredSession {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: Date;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

/**
 * Internal sentinel used to unwind a submit transaction on a stale-revision
 * guard. Throwing inside `withTransaction` aborts the transaction (nothing is
 * committed); the adapter catches it and translates it into a conflict
 * {@link SubmitOutcome} rather than an error. It never escapes the adapter.
 */
class StaleRevisionSignal extends Error {
  readonly server: { revision: number; updatedAt: string; updatedBy: string };

  constructor(server: { revision: number; updatedAt: string; updatedBy: string }) {
    super('stale revision');
    this.name = 'StaleRevisionSignal';
    this.server = server;
  }
}

/** Drop MongoDB's physical `_id` so callers only ever see domain shapes. */
function stripId<T extends Document>(raw: T): Omit<T, '_id'> {
  const { _id, ...rest } = raw as T & { _id?: unknown };
  void _id;
  return rest;
}

export class MongoDocumentRepository implements DocumentRepository, IdentityRepository {
  private readonly client: MongoClient;
  private readonly db: Db;

  private constructor(client: MongoClient, db: Db) {
    this.client = client;
    this.db = db;
  }

  /** Connect, verify reachability and ensure indexes exist. */
  static async connect(
    config: MongoDocumentRepositoryConfig,
  ): Promise<MongoDocumentRepository> {
    const client = new MongoClient(config.uri, {
      // Fail fast in the PoC rather than hanging if Mongo is not running.
      serverSelectionTimeoutMS: 5_000,
    });
    await client.connect();
    const db = client.db(config.dbName);
    const repository = new MongoDocumentRepository(client, db);
    await repository.ensureIndexes();
    return repository;
  }

  private get updates(): Collection<UpdateDocument> {
    return this.db.collection<UpdateDocument>(COLLECTIONS.updates);
  }

  private get versions(): Collection<UpdateVersion> {
    return this.db.collection<UpdateVersion>(COLLECTIONS.updateVersions);
  }

  private get audit(): Collection<AuditEvent> {
    return this.db.collection<AuditEvent>(COLLECTIONS.auditEvents);
  }

  private get decisions(): Collection<LeadershipDecision> {
    return this.db.collection<LeadershipDecision>(COLLECTIONS.decisions);
  }

  private get programmes(): Collection<Programme> {
    return this.db.collection<Programme>(COLLECTIONS.programmes);
  }

  private get streams(): Collection<Stream> {
    return this.db.collection<Stream>(COLLECTIONS.streams);
  }

  private get teams(): Collection<Team> {
    return this.db.collection<Team>(COLLECTIONS.teams);
  }

  private get sprints(): Collection<Sprint> {
    return this.db.collection<Sprint>(COLLECTIONS.sprints);
  }

  private get checkpoints(): Collection<ReportingCheckpoint> {
    return this.db.collection<ReportingCheckpoint>(COLLECTIONS.checkpoints);
  }

  private get users(): Collection<UserAccount> {
    return this.db.collection<UserAccount>(COLLECTIONS.users);
  }

  private get assignments(): Collection<Assignment> {
    return this.db.collection<Assignment>(COLLECTIONS.assignments);
  }

  private get sessions(): Collection<StoredSession> {
    return this.db.collection<StoredSession>(COLLECTIONS.sessions);
  }

  private get notifications(): Collection<Notification> {
    return this.db.collection<Notification>(COLLECTIONS.notifications);
  }

  /**
   * Create the stable-envelope indexes. The unique `id` index is what enforces
   * at-most-one draft per aggregate and append-only immutability for versions
   * and audit events (a second insert with the same id fails).
   */
  private async ensureIndexes(): Promise<void> {
    await this.updates.createIndex({ id: 1 }, { unique: true, name: 'uq_update_id' });
    await this.updates.createIndex(
      { programmeId: 1, sprintId: 1, checkpointId: 1, streamId: 1, state: 1 },
      { name: 'ix_update_leadership' },
    );

    await this.versions.createIndex({ id: 1 }, { unique: true, name: 'uq_version_id' });
    await this.versions.createIndex(
      { teamId: 1, checkpointId: 1, versionNumber: -1 },
      { name: 'ix_version_history' },
    );

    await this.audit.createIndex({ id: 1 }, { unique: true, name: 'uq_audit_id' });
    await this.audit.createIndex(
      { entityId: 1, timestamp: 1 },
      { name: 'ix_audit_entity' },
    );
    // Serves the unified per-update audit trail (newest first). Every lifecycle
    // event for one update shares `aggregateId`; the descending timestamp key
    // matches the endpoint's newest-first ordering.
    await this.audit.createIndex(
      { aggregateId: 1, timestamp: -1 },
      { name: 'ix_audit_aggregate' },
    );

    // Leadership decisions: unique id (append-only immutability) plus the
    // natural lookup by the version the decision was recorded against.
    await this.decisions.createIndex({ id: 1 }, { unique: true, name: 'uq_decision_id' });
    await this.decisions.createIndex(
      { updateVersionId: 1, createdAt: 1 },
      { name: 'ix_decision_version' },
    );

    // Reference/config collections: unique id plus the natural lookup keys.
    await this.programmes.createIndex({ id: 1 }, { unique: true, name: 'uq_programme_id' });
    await this.streams.createIndex({ id: 1 }, { unique: true, name: 'uq_stream_id' });
    await this.streams.createIndex(
      { programmeId: 1, sortOrder: 1 },
      { name: 'ix_stream_programme' },
    );
    await this.teams.createIndex({ id: 1 }, { unique: true, name: 'uq_team_id' });
    await this.teams.createIndex(
      { streamId: 1, sortOrder: 1 },
      { name: 'ix_team_stream' },
    );
    await this.sprints.createIndex({ id: 1 }, { unique: true, name: 'uq_sprint_id' });
    await this.sprints.createIndex(
      { programmeId: 1, startDate: 1 },
      { name: 'ix_sprint_programme' },
    );
    await this.checkpoints.createIndex({ id: 1 }, { unique: true, name: 'uq_checkpoint_id' });
    await this.checkpoints.createIndex(
      { sprintId: 1, weekNumber: 1 },
      { name: 'ix_checkpoint_sprint' },
    );

    // Local-account identity collections (Phase 8). Unique user id + unique
    // (lowercased) email — the email uniqueness index is what enforces "one
    // account per email" even under a registration race.
    await this.users.createIndex({ id: 1 }, { unique: true, name: 'uq_user_id' });
    await this.users.createIndex({ email: 1 }, { unique: true, name: 'uq_user_email' });
    await this.users.createIndex({ status: 1 }, { name: 'ix_user_status' });
    // One assignment document per user.
    await this.assignments.createIndex(
      { userId: 1 },
      { unique: true, name: 'uq_assignment_user' },
    );
    // Sessions: unique id (the token hash) + a lookup by user for revocation.
    // `expiresAt` is a BSON Date carrying a TTL index (expireAfterSeconds: 0),
    // so MongoDB reaps expired sessions automatically. Reads ALSO check expiry
    // explicitly, so an expired session is rejected immediately even before the
    // background TTL monitor runs (design.md §5a).
    await this.sessions.createIndex({ id: 1 }, { unique: true, name: 'uq_session_id' });
    await this.sessions.createIndex({ userId: 1 }, { name: 'ix_session_user' });
    await this.sessions.createIndex(
      { expiresAt: 1 },
      { name: 'ttl_session_expiry', expireAfterSeconds: 0 },
    );

    // In-app notifications (Phase 9, task 9.1). The unique `id` index enforces
    // idempotent generation — a second insert with the same stable key fails,
    // so re-loading the inbox never duplicates. The recipient index serves the
    // per-user inbox listing (newest first) and keeps recipients isolated.
    await this.notifications.createIndex(
      { id: 1 },
      { unique: true, name: 'uq_notification_id' },
    );
    await this.notifications.createIndex(
      { recipientSubject: 1, createdAt: -1 },
      { name: 'ix_notification_recipient' },
    );
  }

  async ping(): Promise<boolean> {
    // Basic reachability first: the server must answer a command.
    const result = await this.db.command({ ping: 1 });
    if (result?.ok !== 1) return false;

    // Readiness for the PoC means more than "reachable": the submit, reopen and
    // decision paths use multi-document transactions, which MongoDB only allows
    // on a replica set (or a mongos in a sharded cluster). A standalone server
    // answers `ping` but every transactional write would fail — so `/ready`
    // must NOT report ready against a standalone. `hello` tells us the topology.
    const hello = await this.db.admin().command({ hello: 1 });
    const inReplicaSet = typeof hello.setName === 'string' && hello.setName.length > 0;
    const isWritablePrimary = hello.isWritablePrimary === true || hello.ismaster === true;
    const isMongos = hello.msg === 'isdbgrid';
    return isMongos || (inReplicaSet && isWritablePrimary);
  }

  // --- reference / config reads (design.md §4a, task 7.3) ------------------

  async seedReferenceData(data: ReferenceData): Promise<void> {
    // Idempotent upsert by stable id — safe to run on every startup.
    const upsert = async <T extends { id: string }>(
      collection: Collection<T>,
      docs: T[],
    ): Promise<void> => {
      if (docs.length === 0) return;
      // The generic `id` filter is safe here (every reference doc is keyed by
      // its stable `id`); the cast bridges the driver's structural Filter type.
      const operations = docs.map((doc) => ({
        replaceOne: {
          filter: { id: doc.id },
          replacement: doc,
          upsert: true,
        },
      })) as unknown as AnyBulkWriteOperation<T>[];
      await collection.bulkWrite(operations, { ordered: false });
    };

    await upsert(this.programmes, data.programmes);
    await upsert(this.streams, data.streams);
    await upsert(this.teams, data.teams);
    await upsert(this.sprints, data.sprints);
    await upsert(this.checkpoints, data.checkpoints);
  }

  async getProgramme(programmeId: string): Promise<Programme | null> {
    const raw = await this.programmes.findOne({ id: programmeId });
    return raw ? (stripId(raw) as Programme) : null;
  }

  async listStreams(programmeId: string): Promise<Stream[]> {
    const raw = await this.streams
      .find({ programmeId })
      .sort({ sortOrder: 1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as Stream);
  }

  async listTeams(programmeId: string): Promise<Team[]> {
    // Teams reference their stream; resolve the programme's stream ids first so
    // the query stays vendor-neutral (no $lookup / join semantics leak out).
    const streamIds = (await this.listStreams(programmeId)).map((s) => s.id);
    if (streamIds.length === 0) return [];
    const raw = await this.teams
      .find({ streamId: { $in: streamIds } })
      .sort({ sortOrder: 1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as Team);
  }

  async listSprints(programmeId: string): Promise<Sprint[]> {
    const raw = await this.sprints
      .find({ programmeId })
      .sort({ startDate: 1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as Sprint);
  }

  async getSprint(sprintId: string): Promise<Sprint | null> {
    const raw = await this.sprints.findOne({ id: sprintId });
    return raw ? (stripId(raw) as Sprint) : null;
  }

  async listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]> {
    const raw = await this.checkpoints
      .find({ sprintId })
      .sort({ weekNumber: 1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as ReportingCheckpoint);
  }

  async getTeam(teamId: string): Promise<Team | null> {
    const raw = await this.teams.findOne({ id: teamId });
    return raw ? (stripId(raw) as Team) : null;
  }

  async getCheckpoint(checkpointId: string): Promise<ReportingCheckpoint | null> {
    const raw = await this.checkpoints.findOne({ id: checkpointId });
    return raw ? (stripId(raw) as ReportingCheckpoint) : null;
  }

  async getStream(streamId: string): Promise<Stream | null> {
    const raw = await this.streams.findOne({ id: streamId });
    return raw ? (stripId(raw) as Stream) : null;
  }

  // --- reference / config admin writes (design.md §4a, task 9.5) -----------

  async saveStreamWithAudit(stream: Stream, audit: AuditEvent): Promise<Stream> {
    // A single transaction makes the config upsert and the append-only audit
    // event atomic (design.md §4a): a hierarchy change never persists without
    // its audit record, and never uses sequential independent writes (R17).
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.streams.replaceOne({ id: stream.id }, { ...stream }, { upsert: true, session });
        await this.audit.insertOne({ ...audit }, { session });
      });
      return stream;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError('SAVE_FAILED', 'The stream could not be saved.');
    } finally {
      await session.endSession();
    }
  }

  async saveTeamWithAudit(team: Team, audit: AuditEvent): Promise<Team> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.teams.replaceOne({ id: team.id }, { ...team }, { upsert: true, session });
        await this.audit.insertOne({ ...audit }, { session });
      });
      return team;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError('SAVE_FAILED', 'The team could not be saved.');
    } finally {
      await session.endSession();
    }
  }

  async createSprint(
    sprint: Sprint,
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }> {
    // The sprint, its two weekly checkpoints and the audit event are written as
    // ONE transaction (R2.1, design.md §4a). A NEW sprint is inserted (never
    // overwritten); a duplicate sprint id (unique `id` index) or any other
    // failure aborts the transaction, leaving no partial sprint/checkpoints and
    // no orphan audit event.
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.sprints.insertOne({ ...sprint }, { session });
        if (checkpoints.length > 0) {
          await this.checkpoints.insertMany(
            checkpoints.map((c) => ({ ...c })),
            { session },
          );
        }
        await this.audit.insertOne({ ...audit }, { session });
      });
      return { sprint, checkpoints };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new DuplicateKeyError(`A sprint with id "${sprint.id}" already exists.`);
      }
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError('SAVE_FAILED', 'The sprint could not be created.');
    } finally {
      await session.endSession();
    }
  }

  async saveCheckpointsWithAudit(
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<ReportingCheckpoint[]> {
    // Reporting-window transitions upsert every affected checkpoint AND append
    // the audit event in ONE transaction (design.md §4a): promoting the target
    // and demoting the previously current checkpoint commit together, so the
    // "exactly one CURRENT" invariant is never observable as multiple/zero
    // CURRENT, and a failure leaves no orphan audit event (R2.2/R2.3).
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        if (checkpoints.length > 0) {
          const operations = checkpoints.map((checkpoint) => ({
            replaceOne: {
              filter: { id: checkpoint.id },
              replacement: { ...checkpoint },
              upsert: true,
            },
          })) as unknown as AnyBulkWriteOperation<ReportingCheckpoint>[];
          await this.checkpoints.bulkWrite(operations, { ordered: true, session });
        }
        await this.audit.insertOne({ ...audit }, { session });
      });
      return checkpoints;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError('SAVE_FAILED', 'The checkpoint change could not be saved.');
    } finally {
      await session.endSession();
    }
  }

  async getDraft(id: string): Promise<UpdateDocument | null> {
    const raw = await this.updates.findOne({ id });
    return raw ? (stripId(raw) as UpdateDocument) : null;
  }

  async listUpdates(query: UpdateQuery): Promise<UpdateDocument[]> {
    // Filter on stable envelope fields only — the compound `ix_update_leadership`
    // index (programmeId, sprintId, checkpointId, streamId, state) serves this.
    const filter: Filter<UpdateDocument> = { programmeId: query.programmeId };
    if (query.sprintId) filter.sprintId = query.sprintId;
    if (query.checkpointId) filter.checkpointId = query.checkpointId;
    if (query.streamId) filter.streamId = query.streamId;
    const raw = await this.updates.find(filter).toArray();
    return raw.map((doc) => stripId(doc) as UpdateDocument);
  }

  async listVersionsForProgramme(programmeId: string): Promise<UpdateVersion[]> {
    const raw = await this.versions
      .find({ programmeId })
      .sort({ versionNumber: -1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as UpdateVersion);
  }

  async saveDraft(input: SaveDraftInput): Promise<WriteOutcome<UpdateDocument>> {
    const { document, expectedRevision } = input;
    const nextRevision = expectedRevision + 1;
    // The stored revision is authoritative — never trust a revision inside the
    // supplied document body.
    const toStore: UpdateDocument = { ...document, revision: nextRevision };

    // expectedRevision 0 means "creating a brand-new draft".
    if (expectedRevision === 0) {
      try {
        await this.updates.insertOne({ ...toStore });
        return { ok: true, document: toStore };
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          // Another writer created this draft first — surface as a conflict.
          return this.conflictOutcome(document.id);
        }
        throw new RepositoryError('SAVE_FAILED', 'The draft could not be saved.');
      }
    }

    // Conditional update: only succeeds when the stored revision still matches.
    const { id, revision: _ignored, ...mutableFields } = toStore;
    void _ignored;
    const updated = await this.updates.findOneAndUpdate(
      { id, revision: expectedRevision },
      { $set: { ...mutableFields, revision: nextRevision } },
      { returnDocument: 'after' },
    );

    if (!updated) {
      // Either the document is gone or its revision moved on: never overwrite.
      return this.conflictOutcome(id);
    }
    return { ok: true, document: stripId(updated) as UpdateDocument };
  }

  /** Build a conflict outcome from the current server-side envelope. */
  private async conflictOutcome(id: string): Promise<WriteOutcome<UpdateDocument>> {
    const current = await this.getDraft(id);
    return {
      ok: false,
      conflict: true,
      server: {
        revision: current?.revision ?? 0,
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
        updatedBy: current?.updatedBy ?? 'unknown',
      },
    };
  }

  async submitUpdate(input: SubmitDraftInput): Promise<SubmitOutcome> {
    const { document, version, audit, expectedRevision } = input;
    const nextRevision = expectedRevision + 1;
    // The stored revision is authoritative — never trust the body's revision.
    const toStore: UpdateDocument = { ...document, revision: nextRevision };

    // A single transaction makes the three writes — draft transition, immutable
    // version append and audit append — atomic (design.md §4a). If any step
    // fails (including a stale-revision guard or a duplicate version id) the
    // whole unit is rolled back and nothing is left behind. Transactions
    // require a replica set / mongos; the production store and the submit tests
    // both provide one.
    const session = this.client.startSession();
    try {
      let storedDocument: UpdateDocument | undefined;

      await session.withTransaction(async () => {
        // Reset per-attempt state: withTransaction may retry the callback.
        storedDocument = undefined;

        if (expectedRevision === 0) {
          // Submitting a fresh draft (no stored document yet): insert it. A
          // pre-existing document means someone else got there first.
          const existing = await this.updates.findOne({ id: document.id }, { session });
          if (existing) {
            throw new StaleRevisionSignal(this.metaFrom(stripId(existing) as UpdateDocument));
          }
          await this.updates.insertOne({ ...toStore }, { session });
          storedDocument = toStore;
        } else {
          // Conditional transition: only when the stored revision still matches.
          const { id, revision: _ignored, ...mutableFields } = toStore;
          void _ignored;
          const updated = await this.updates.findOneAndUpdate(
            { id, revision: expectedRevision },
            { $set: { ...mutableFields, revision: nextRevision } },
            { session, returnDocument: 'after' },
          );
          if (!updated) {
            const current = await this.updates.findOne({ id }, { session });
            throw new StaleRevisionSignal(
              current
                ? this.metaFrom(stripId(current) as UpdateDocument)
                : { revision: 0, updatedAt: new Date(0).toISOString(), updatedBy: 'unknown' },
            );
          }
          storedDocument = stripId(updated) as UpdateDocument;
        }

        // Append-only immutable snapshot + audit event within the same txn.
        await this.versions.insertOne({ ...version }, { session });
        await this.audit.insertOne({ ...audit }, { session });
      });

      // withTransaction only returns after a successful commit.
      return { ok: true, document: storedDocument as UpdateDocument, version };
    } catch (error) {
      if (error instanceof StaleRevisionSignal) {
        return { ok: false, conflict: true, server: error.server };
      }
      if (isDuplicateKeyError(error)) {
        // A concurrent submit created the same immutable version/audit id.
        throw new ImmutableViolationError(
          'A submitted version with this id already exists and is immutable.',
        );
      }
      throw new RepositoryError('SAVE_FAILED', 'The submission could not be stored.');
    } finally {
      await session.endSession();
    }
  }

  async reopenUpdate(input: ReopenUpdateInput): Promise<ReopenOutcome> {
    const { document, audit, expectedRevision } = input;
    const nextRevision = expectedRevision + 1;
    // The stored revision is authoritative — never trust the body's revision.
    const toStore: UpdateDocument = { ...document, revision: nextRevision };

    // A single transaction makes the two writes — the SUBMITTED -> REOPENED
    // draft transition and the append-only audit event — atomic (design.md
    // §4a). The immutable submitted version is never touched here, so a reopen
    // cannot mutate or delete leadership evidence (R11.4). If any step fails
    // (including a stale-revision guard) the whole unit rolls back and no orphan
    // audit document is left behind. Transactions require a replica set / mongos.
    const session = this.client.startSession();
    try {
      let storedDocument: UpdateDocument | undefined;

      await session.withTransaction(async () => {
        // Reset per-attempt state: withTransaction may retry the callback.
        storedDocument = undefined;

        if (expectedRevision === 0) {
          // No draft aggregate exists yet (edge case): insert the REOPENED
          // envelope. A pre-existing document means someone else got there first.
          const existing = await this.updates.findOne({ id: document.id }, { session });
          if (existing) {
            throw new StaleRevisionSignal(this.metaFrom(stripId(existing) as UpdateDocument));
          }
          await this.updates.insertOne({ ...toStore }, { session });
          storedDocument = toStore;
        } else {
          // Conditional transition: only when the stored revision still matches.
          const { id, revision: _ignored, ...mutableFields } = toStore;
          void _ignored;
          const updated = await this.updates.findOneAndUpdate(
            { id, revision: expectedRevision },
            { $set: { ...mutableFields, revision: nextRevision } },
            { session, returnDocument: 'after' },
          );
          if (!updated) {
            const current = await this.updates.findOne({ id }, { session });
            throw new StaleRevisionSignal(
              current
                ? this.metaFrom(stripId(current) as UpdateDocument)
                : { revision: 0, updatedAt: new Date(0).toISOString(), updatedBy: 'unknown' },
            );
          }
          storedDocument = stripId(updated) as UpdateDocument;
        }

        // Append-only reopen audit event within the same transaction.
        await this.audit.insertOne({ ...audit }, { session });
      });

      // withTransaction only returns after a successful commit.
      return { ok: true, document: storedDocument as UpdateDocument };
    } catch (error) {
      if (error instanceof StaleRevisionSignal) {
        return { ok: false, conflict: true, server: error.server };
      }
      if (isDuplicateKeyError(error)) {
        // A concurrent reopen created the same audit id.
        throw new ImmutableViolationError(
          'An audit event with this id already exists; audit data is append-only.',
        );
      }
      throw new RepositoryError('SAVE_FAILED', 'The reopen could not be stored.');
    } finally {
      await session.endSession();
    }
  }

  /** Extract the server-side envelope metadata from a stored document. */
  private metaFrom(document: UpdateDocument): {
    revision: number;
    updatedAt: string;
    updatedBy: string;
  } {
    return {
      revision: document.revision,
      updatedAt: document.updatedAt,
      updatedBy: document.updatedBy,
    };
  }

  async appendVersion(version: UpdateVersion): Promise<UpdateVersion> {
    try {
      await this.versions.insertOne({ ...version });
      return version;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ImmutableViolationError(
          'A submitted version with this id already exists and is immutable.',
        );
      }
      throw new RepositoryError('SAVE_FAILED', 'The version could not be stored.');
    }
  }

  async getVersion(id: string): Promise<UpdateVersion | null> {
    const raw = await this.versions.findOne({ id });
    return raw ? (stripId(raw) as UpdateVersion) : null;
  }

  async listVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]> {
    const raw = await this.versions
      .find({ teamId, checkpointId })
      .sort({ versionNumber: -1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as UpdateVersion);
  }

  async appendAudit(event: AuditEvent): Promise<AuditEvent> {
    try {
      await this.audit.insertOne({ ...event });
      return event;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ImmutableViolationError(
          'An audit event with this id already exists; audit data is append-only.',
        );
      }
      throw new RepositoryError('SAVE_FAILED', 'The audit event could not be stored.');
    }
  }

  async listAudit(entityId: string): Promise<AuditEvent[]> {
    const raw = await this.audit
      .find({ entityId })
      .sort({ timestamp: 1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as AuditEvent);
  }

  async listAuditForAggregate(aggregateId: string): Promise<AuditEvent[]> {
    // Newest first. `_id` (a monotonic ObjectId) is the deterministic
    // tie-breaker when two events share an identical millisecond timestamp, so
    // the ordering is stable even for events appended in quick succession
    // (e.g. submit -> reopen -> resubmit -> decision in one test).
    const raw = await this.audit
      .find({ aggregateId })
      .sort({ timestamp: -1, _id: -1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as AuditEvent);
  }

  async queryAudit(query: AuditQuery): Promise<AuditPageResult> {
    const filter: Filter<AuditEvent> = {};
    if (query.userId) filter.aggregateId = query.userId;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.action) filter.action = query.action;

    const [raw, total] = await Promise.all([
      this.audit
        .find(filter)
        // Newest-first; `_id` (monotonic ObjectId) is the deterministic
        // tie-breaker when timestamps collide within a millisecond.
        .sort({ timestamp: -1, _id: -1 })
        .skip(query.offset)
        .limit(query.limit)
        .toArray(),
      this.audit.countDocuments(filter),
    ]);
    return { events: raw.map((doc) => stripId(doc) as AuditEvent), total };
  }

  async recordDecision(input: RecordDecisionInput): Promise<LeadershipDecision> {
    const { decision, audit } = input;

    // A single transaction makes the two append-only writes — the immutable
    // decision document and the audit event — atomic (design.md §4a). The
    // referenced submitted version and the team's original ask are never
    // touched here, so recording a decision cannot mutate leadership evidence
    // (R10.3). If either insert fails the whole unit rolls back and no orphan
    // decision or audit document is left behind. Transactions require a replica
    // set / mongos, which the production store and the decision tests provide.
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.decisions.insertOne({ ...decision }, { session });
        await this.audit.insertOne({ ...audit }, { session });
      });
      return decision;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // A concurrent write created the same decision/audit id.
        throw new ImmutableViolationError(
          'A leadership decision with this id already exists and is immutable.',
        );
      }
      throw new RepositoryError('SAVE_FAILED', 'The decision could not be stored.');
    } finally {
      await session.endSession();
    }
  }

  async getDecision(id: string): Promise<LeadershipDecision | null> {
    const raw = await this.decisions.findOne({ id });
    return raw ? (stripId(raw) as LeadershipDecision) : null;
  }

  async listDecisions(versionId: string): Promise<LeadershipDecision[]> {
    const raw = await this.decisions
      .find({ updateVersionId: versionId })
      .sort({ createdAt: 1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as LeadershipDecision);
  }

  // --- local-account identity (Phase 8, design.md §5a) --------------------

  async insertUser(user: UserAccount): Promise<void> {
    try {
      await this.users.insertOne({ ...user });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // A duplicate id or (lowercased) email — surface a neutral duplicate so
        // the service maps it to EMAIL_TAKEN without leaking the driver error.
        throw new DuplicateKeyError('A user with this email already exists.');
      }
      throw new RepositoryError('SAVE_FAILED', 'The user could not be stored.');
    }
  }

  async getUserById(id: string): Promise<UserAccount | null> {
    const raw = await this.users.findOne({ id });
    return raw ? (stripId(raw) as UserAccount) : null;
  }

  async getUserByEmail(email: string): Promise<UserAccount | null> {
    const raw = await this.users.findOne({ email: email.toLowerCase() });
    return raw ? (stripId(raw) as UserAccount) : null;
  }

  async listUsers(status?: AccountStatus): Promise<UserAccount[]> {
    const filter = status ? { status } : {};
    const raw = await this.users.find(filter).sort({ createdAt: 1 }).toArray();
    return raw.map((doc) => stripId(doc) as UserAccount);
  }

  async updateUserStatus(
    id: string,
    status: AccountStatus,
    updatedAt: string,
  ): Promise<UserAccount | null> {
    const updated = await this.users.findOneAndUpdate(
      { id },
      { $set: { status, updatedAt } },
      { returnDocument: 'after' },
    );
    return updated ? (stripId(updated) as UserAccount) : null;
  }

  async getAssignment(userId: string): Promise<Assignment | null> {
    const raw = await this.assignments.findOne({ userId });
    return raw ? (stripId(raw) as Assignment) : null;
  }

  async upsertAssignment(assignment: Assignment): Promise<void> {
    await this.assignments.replaceOne(
      { userId: assignment.userId },
      { ...assignment },
      { upsert: true },
    );
  }

  async createSession(session: SessionRecord): Promise<void> {
    try {
      // Persist expiresAt as a BSON Date so the TTL index can reap it; the
      // domain contract keeps ISO strings elsewhere.
      await this.sessions.insertOne({
        id: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: new Date(session.expiresAt),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new DuplicateKeyError('A session with this id already exists.');
      }
      throw new RepositoryError('SAVE_FAILED', 'The session could not be stored.');
    }
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const raw = await this.sessions.findOne({ id });
    if (!raw) return null;
    const stored = stripId(raw) as StoredSession;
    // Reject an expired session immediately, even before the background TTL
    // monitor runs, and reap it opportunistically.
    if (stored.expiresAt.getTime() <= Date.now()) {
      await this.sessions.deleteOne({ id });
      return null;
    }
    // Map the BSON Date back to the vendor-neutral ISO-string contract.
    return {
      id: stored.id,
      userId: stored.userId,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt.toISOString(),
    };
  }

  async deleteSession(id: string): Promise<void> {
    await this.sessions.deleteOne({ id });
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.sessions.deleteMany({ userId });
  }

  // --- atomic identity workflows (Phase 8 repair) --------------------------
  //
  // Each is a single MongoDB transaction: all writes commit together or none do
  // (a mid-way failure aborts and rolls back). Transactions require a replica
  // set / mongos, which the production store and the tests provide.

  async createUserWithAudit(input: CreateUserAtomicInput): Promise<void> {
    await this.runIdentityTransaction(async (session) => {
      await this.users.insertOne({ ...input.user }, { session });
      await this.audit.insertOne({ ...input.audit }, { session });
    }, 'The account could not be created.');
  }

  async approveUserWithAssignment(input: ApproveUserAtomicInput): Promise<UserAccount> {
    let updated: UserAccount | undefined;
    await this.runIdentityTransaction(async (session) => {
      await this.assignments.replaceOne(
        { userId: input.assignment.userId },
        { ...input.assignment },
        { upsert: true, session },
      );
      const doc = await this.users.findOneAndUpdate(
        { id: input.userId },
        { $set: { status: input.status, updatedAt: input.updatedAt } },
        { returnDocument: 'after', session },
      );
      if (!doc) throw new RepositoryError('NOT_FOUND', 'User not found.');
      for (const event of input.audits) {
        await this.audit.insertOne({ ...event }, { session });
      }
      updated = stripId(doc) as UserAccount;
    }, 'The approval could not be stored.');
    return updated as UserAccount;
  }

  async updateAssignmentWithAudit(input: UpdateAssignmentAtomicInput): Promise<void> {
    await this.runIdentityTransaction(async (session) => {
      await this.assignments.replaceOne(
        { userId: input.assignment.userId },
        { ...input.assignment },
        { upsert: true, session },
      );
      await this.audit.insertOne({ ...input.audit }, { session });
    }, 'The assignment could not be stored.');
  }

  async changeUserStatusWithAudit(input: ChangeStatusAtomicInput): Promise<UserAccount> {
    let updated: UserAccount | undefined;
    await this.runIdentityTransaction(async (session) => {
      const doc = await this.users.findOneAndUpdate(
        { id: input.userId },
        { $set: { status: input.status, updatedAt: input.updatedAt } },
        { returnDocument: 'after', session },
      );
      if (!doc) throw new RepositoryError('NOT_FOUND', 'User not found.');
      if (input.revokeSessions) {
        await this.sessions.deleteMany({ userId: input.userId }, { session });
      }
      await this.audit.insertOne({ ...input.audit }, { session });
      updated = stripId(doc) as UserAccount;
    }, 'The status change could not be stored.');
    return updated as UserAccount;
  }

  async createAdminAtomically(input: CreateAdminAtomicInput): Promise<void> {
    await this.runIdentityTransaction(async (session) => {
      await this.users.insertOne({ ...input.user }, { session });
      await this.assignments.replaceOne(
        { userId: input.assignment.userId },
        { ...input.assignment },
        { upsert: true, session },
      );
      await this.audit.insertOne({ ...input.audit }, { session });
    }, 'The admin account could not be created.');
  }

  /**
   * Run an identity write inside a transaction, translating a duplicate-key
   * collision to a neutral {@link DuplicateKeyError} and any other failure to a
   * SAVE_FAILED (unless it is already a RepositoryError). withTransaction rolls
   * back automatically when the callback throws.
   */
  private async runIdentityTransaction(
    work: (session: ClientSession) => Promise<void>,
    failMessage: string,
  ): Promise<void> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await work(session);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new DuplicateKeyError('A record with this key already exists.');
      }
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError('SAVE_FAILED', failMessage);
    } finally {
      await session.endSession();
    }
  }

  // --- in-app notifications (Phase 9, task 9.1) ---------------------------

  async insertNotificationIfAbsent(notification: Notification): Promise<boolean> {
    try {
      await this.notifications.insertOne({ ...notification });
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // A notification with this stable key already exists — idempotent
        // generation, not an error. Nothing is overwritten (read state kept).
        return false;
      }
      throw new RepositoryError('SAVE_FAILED', 'The notification could not be stored.');
    }
  }

  async listNotificationsForRecipient(recipientSubject: string): Promise<Notification[]> {
    const raw = await this.notifications
      .find({ recipientSubject })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    return raw.map((doc) => stripId(doc) as Notification);
  }

  async getNotification(id: string): Promise<Notification | null> {
    const raw = await this.notifications.findOne({ id });
    return raw ? (stripId(raw) as Notification) : null;
  }

  async markNotificationRead(
    id: string,
    recipientSubject: string,
    readAt: string,
  ): Promise<Notification | null> {
    // The recipient guard is part of the filter, so a caller can only ever mark
    // their OWN notification read (no cross-recipient writes).
    const updated = await this.notifications.findOneAndUpdate(
      { id, recipientSubject },
      { $set: { readAt } },
      { returnDocument: 'after' },
    );
    return updated ? (stripId(updated) as Notification) : null;
  }

  async markAllNotificationsRead(recipientSubject: string, readAt: string): Promise<number> {
    const result = await this.notifications.updateMany(
      { recipientSubject, readAt: { $exists: false } },
      { $set: { readAt } },
    );
    return result.modifiedCount;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
