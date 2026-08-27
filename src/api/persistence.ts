/**
 * Document-oriented, vendor-neutral persistence model (design.md §4a).
 *
 * This module is a *definition*, not a database dependency. It declares — in
 * compile-checked TypeScript — the collections/containers, stable query
 * envelopes, indexes, partition/shard strategy, schema-version compatibility,
 * retention rules and immutable/append-only audit guarantees that a Phase B
 * document store (e.g. Cosmos DB or MongoDB) must satisfy.
 *
 * Design constraints honoured here (do NOT change without updating design.md):
 *  - No relational schema, migrations or hard DB dependency is introduced.
 *  - Every persisted document maps 1:1 to the already-built domain types
 *    (src/domain/*) and the server repository contract (src/api/repository.ts),
 *    which is the same contract expressed in the OpenAPI file. The `Pick<>`
 *    envelopes below fail to compile if a domain field is renamed or removed,
 *    keeping the document contract and the API contract in lockstep.
 *  - Stable leadership filter fields (state, rag, hasBlocker, hasLeadershipAsk
 *    and the hierarchy IDs) live in the *envelope*, never buried in the payload,
 *    so filtering and indexing never reach into an arbitrary payload shape.
 *  - Partition/shard key is programmeId, with teamId as the natural sub-key.
 *  - Submitted versions and audit events are immutable / append-only.
 *  - Optimistic concurrency uses `revision` as an ETag; a stale revision on
 *    write returns 409 and overwrites nothing.
 *
 * Traceability: R2 (immutable versions), R11 (draft/submission/concurrency),
 * R14 (append-only history/audit), R17 (administration/archival), plus the
 * security (§13) and reliability/concurrency non-functional requirements.
 */
import { CURRENT_SCHEMA_VERSION, PROGRAMME_ID } from '../config';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy';
import type {
  AuditEvent,
  ExceptionItem,
  LeadershipDecision,
  UpdateDocument,
  UpdatePayload,
  UpdateVersion,
} from '../domain/update';
import type { Role } from './repository';

// ---------------------------------------------------------------------------
// Collections / containers
// ---------------------------------------------------------------------------

/**
 * The complete set of document collections/containers. Reference/config
 * documents (hierarchy + reporting cycle) are separated from the transactional
 * update aggregates and the append-only audit/decision stores.
 */
export type CollectionName =
  | 'programmes'
  | 'streams'
  | 'teams'
  | 'sprints'
  | 'checkpoints'
  | 'assignments'
  | 'updates'
  | 'updateVersions'
  | 'decisions'
  | 'auditEvents';

// ---------------------------------------------------------------------------
// Store-level persistence metadata (added by the adapter, not the domain)
// ---------------------------------------------------------------------------

/**
 * Vendor-neutral metadata every stored document carries in addition to its
 * domain fields. `partitionKey` is always the programmeId; `subKey` is the
 * natural co-location key (teamId where a team owns the document).
 */
export interface PersistenceMeta {
  /** Partition/shard key value. Always the programmeId (design.md §4a). */
  partitionKey: string;
  /**
   * Natural sub-key used for intra-partition co-location and range queries.
   * teamId for team-owned documents; undefined for programme-level config.
   */
  subKey?: string;
  /**
   * Store-native concurrency token mirroring `revision`. Optional because the
   * domain already exposes `revision`; adapters MAY map this to the physical
   * ETag/_etag field. Never used as the source of truth on its own.
   */
  etag?: string;
  /**
   * Time-to-live in seconds, or null to retain indefinitely. Only the
   * `retention.policy === 'TTL'` collections may set a positive value.
   */
  ttlSeconds?: number | null;
}

/** A stored document = its domain shape + vendor-neutral persistence metadata. */
export type Persisted<TDomain> = TDomain & PersistenceMeta;

// ---------------------------------------------------------------------------
// Assignment aggregate (no domain type existed yet — declared here)
// ---------------------------------------------------------------------------

/**
 * A user's assignment to a team. Assignment changes take effect without
 * changing historical authorship (R17.4): they are effective-dated rather than
 * destructive, so past submissions keep their original `submittedBy`.
 */
export interface AssignmentPayload {
  subject: string; // OIDC subject claim
  displayName: string;
  roles: Role[];
  streamId: string;
  teamId: string;
  active: boolean;
  effectiveFrom: string; // ISO datetime (UTC)
  effectiveTo?: string; // set (not deleted) when an assignment ends
}

export interface AssignmentDocument {
  id: string; // `${teamId}|${subject}`
  programmeId: string;
  streamId: string;
  teamId: string;
  subject: string;
  active: boolean;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  payload: AssignmentPayload;
}

// ---------------------------------------------------------------------------
// Stable query envelopes (indexable fields, NEVER buried in payload)
// ---------------------------------------------------------------------------
//
// Each envelope is derived from its domain type with `Pick<>`. This is the
// compile-checked contract: if a field named below is removed or renamed in
// the domain type, this file stops compiling — surfacing drift immediately.

/** Stable, indexable envelope for the mutable draft aggregate (`updates`). */
export type UpdateQueryEnvelope = Pick<
  UpdateDocument,
  | 'id'
  | 'programmeId'
  | 'streamId'
  | 'teamId'
  | 'sprintId'
  | 'checkpointId'
  | 'state'
  | 'revision'
  | 'schemaVersion'
  | 'rag'
  | 'hasBlocker'
  | 'hasLeadershipAsk'
  | 'createdAt'
  | 'updatedAt'
  | 'submittedAt'
>;

/** Stable, indexable envelope for immutable submitted snapshots. */
export type UpdateVersionQueryEnvelope = Pick<
  UpdateVersion,
  | 'id'
  | 'teamId'
  | 'sprintId'
  | 'checkpointId'
  | 'versionNumber'
  | 'submittedBy'
  | 'submittedAt'
  | 'schemaVersion'
  | 'rag'
  | 'hasBlocker'
  | 'hasLeadershipAsk'
> & {
  // Denormalised hierarchy keys added at write time so versions partition by
  // programmeId and index by stream without reading the payload.
  programmeId: string;
  streamId: string;
};

/** Stable, indexable envelope for append-only audit documents. */
export type AuditQueryEnvelope = Pick<
  AuditEvent,
  | 'id'
  | 'programmeId'
  | 'entityType'
  | 'entityId'
  | 'action'
  | 'actorSubject'
  | 'timestamp'
  | 'previousVersion'
  | 'newVersion'
  | 'correlationId'
>;

/** Stable, indexable envelope for leadership decisions. */
export type DecisionQueryEnvelope = Pick<
  LeadershipDecision,
  'id' | 'updateVersionId' | 'ownerSubject' | 'status' | 'dueDate' | 'createdAt'
> & {
  // Denormalised so decisions partition by programmeId like everything else.
  programmeId: string;
};

// ---------------------------------------------------------------------------
// Persisted document records (domain payload + persistence metadata)
// ---------------------------------------------------------------------------
//
// The payload of each record is the domain type verbatim, guaranteeing the
// document contract is identical to the planned server repository contract
// and to the OpenAPI component schemas.

export type ProgrammeRecord = Persisted<Programme>;
export type StreamRecord = Persisted<Stream>;
export type TeamRecord = Persisted<Team>;
export type SprintRecord = Persisted<Sprint>;
/** Checkpoints are stored under their owning programme's partition. */
export type CheckpointRecord = Persisted<ReportingCheckpoint & { programmeId: string }>;
export type AssignmentRecord = Persisted<AssignmentDocument>;
export type UpdateRecord = Persisted<UpdateDocument>;
export type UpdateVersionRecord = Persisted<UpdateVersion & { programmeId: string; streamId: string }>;
export type DecisionRecord = Persisted<LeadershipDecision & { programmeId: string }>;
export type AuditRecord = Persisted<AuditEvent>;

/**
 * Exceptions are NOT a top-level collection. A Risk/Issue/Blocker is part of
 * the update aggregate and is stored embedded in `payload.exceptions` of both
 * the draft (`updates`) and the immutable snapshot (`updateVersions`). The
 * leadership-relevant fact "an open Blocker exists" is denormalised to the
 * envelope flag `hasBlocker`, which is what gets indexed — filtering never
 * scans the embedded array.
 */
export type EmbeddedException = ExceptionItem;

// ---------------------------------------------------------------------------
// Index + partition descriptors
// ---------------------------------------------------------------------------

export interface IndexDescriptor {
  name: string;
  /**
   * Envelope field paths to index. Dotted paths are permitted only for
   * envelope objects (e.g. `rag.release`); payload paths are forbidden.
   */
  fields: readonly string[];
  unique?: boolean;
  description: string;
}

export type RetentionPolicy =
  | 'RETAIN_INDEFINITELY' // never auto-expire (audit, versions, decisions)
  | 'ARCHIVE_ON_TEAM_REMOVAL' // team removal archives, never deletes (R17.2)
  | 'TTL'; // optional time-based expiry (not used for evidence)

export interface RetentionRule {
  policy: RetentionPolicy;
  /** Positive seconds only when policy === 'TTL'; otherwise null. */
  ttlSeconds: number | null;
  notes: string;
}

export type ConcurrencyStrategy =
  | 'OPTIMISTIC_REVISION' // revision/ETag guard, stale write -> 409
  | 'APPEND_ONLY' // create-only; existing documents never mutated
  | 'READ_MOSTLY'; // config/reference data, admin-managed writes

export interface CollectionDescriptor {
  name: CollectionName;
  purpose: string;
  /** Partition/shard key path. Always '/programmeId' (design.md §4a). */
  partitionKeyPath: '/programmeId';
  /** Natural intra-partition sub-key, or null for programme-level config. */
  subKeyPath: '/teamId' | '/streamId' | '/sprintId' | null;
  /** How stable document IDs are formed. */
  idStrategy: string;
  indexes: readonly IndexDescriptor[];
  /** True when stored documents are never updated in place. */
  immutable: boolean;
  /** True when the collection only ever accepts inserts. */
  appendOnly: boolean;
  /** Every collection carries `schemaVersion` and is read through the registry. */
  schemaVersioned: true;
  retention: RetentionRule;
  concurrency: ConcurrencyStrategy;
}

const RETAIN: RetentionRule = {
  policy: 'RETAIN_INDEFINITELY',
  ttlSeconds: null,
  notes: 'Immutable evidence — retained for the life of the programme.',
};

const ARCHIVE_ON_REMOVAL: RetentionRule = {
  policy: 'ARCHIVE_ON_TEAM_REMOVAL',
  ttlSeconds: null,
  notes:
    'Removing a team sets archivedAt/effectiveTo; historical submissions are ' +
    'never deleted (R17.2, R14.1).',
};

/**
 * The persistence model: one descriptor per collection. This is the concrete,
 * checked-in definition the Phase B server provisions its containers from.
 */
export const PERSISTENCE_MODEL: Record<CollectionName, CollectionDescriptor> = {
  programmes: {
    name: 'programmes',
    purpose: 'Programme reference/config documents (R1, R17.1).',
    partitionKeyPath: '/programmeId',
    subKeyPath: null,
    idStrategy: 'programmeId',
    indexes: [{ name: 'pk_programme', fields: ['id'], unique: true, description: 'Primary key.' }],
    immutable: false,
    appendOnly: false,
    schemaVersioned: true,
    retention: RETAIN,
    concurrency: 'READ_MOSTLY',
  },
  streams: {
    name: 'streams',
    purpose: 'Stream reference/config documents (R1, R17.1).',
    partitionKeyPath: '/programmeId',
    subKeyPath: null,
    idStrategy: 'streamId',
    indexes: [
      { name: 'pk_stream', fields: ['id'], unique: true, description: 'Primary key.' },
      { name: 'ix_stream_programme', fields: ['programmeId', 'sortOrder'], description: 'Ordered streams within a programme.' },
    ],
    immutable: false,
    appendOnly: false,
    schemaVersioned: true,
    retention: RETAIN,
    concurrency: 'READ_MOSTLY',
  },
  teams: {
    name: 'teams',
    purpose: 'Team reference/config documents; archival, never deletion (R17.2, R17.3).',
    partitionKeyPath: '/programmeId',
    subKeyPath: '/streamId',
    idStrategy: 'teamId',
    indexes: [
      { name: 'pk_team', fields: ['id'], unique: true, description: 'Primary key.' },
      { name: 'ix_team_stream', fields: ['streamId', 'sortOrder'], description: 'Ordered teams within a stream.' },
      { name: 'ix_team_active', fields: ['active'], description: 'Active vs archived teams (archivedAt set on removal).' },
    ],
    immutable: false,
    appendOnly: false,
    schemaVersioned: true,
    retention: ARCHIVE_ON_REMOVAL,
    concurrency: 'READ_MOSTLY',
  },
  sprints: {
    name: 'sprints',
    purpose: 'Sprint reporting-cycle config; prior sprints retained (R2.1, R2.2).',
    partitionKeyPath: '/programmeId',
    subKeyPath: '/sprintId',
    idStrategy: 'sprintId',
    indexes: [
      { name: 'pk_sprint', fields: ['id'], unique: true, description: 'Primary key.' },
      { name: 'ix_sprint_status', fields: ['programmeId', 'status'], description: 'Locate the CURRENT sprint quickly.' },
    ],
    immutable: false,
    appendOnly: false,
    schemaVersioned: true,
    retention: RETAIN,
    concurrency: 'READ_MOSTLY',
  },
  checkpoints: {
    name: 'checkpoints',
    purpose: 'Weekly reporting checkpoints (Week 1 / Week 2) per sprint (R2.1, R2.2).',
    partitionKeyPath: '/programmeId',
    subKeyPath: '/sprintId',
    idStrategy: 'checkpointId',
    indexes: [
      { name: 'pk_checkpoint', fields: ['id'], unique: true, description: 'Primary key.' },
      { name: 'ix_checkpoint_sprint', fields: ['sprintId', 'weekNumber'], description: 'Ordered checkpoints within a sprint.' },
      { name: 'ix_checkpoint_status', fields: ['status'], description: 'Locate the CURRENT checkpoint.' },
    ],
    immutable: false,
    appendOnly: false,
    schemaVersioned: true,
    retention: RETAIN,
    concurrency: 'READ_MOSTLY',
  },
  assignments: {
    name: 'assignments',
    purpose: 'User-to-team assignments; effective-dated so history keeps authorship (R3.1, R17.4).',
    partitionKeyPath: '/programmeId',
    subKeyPath: '/teamId',
    idStrategy: '`${teamId}|${subject}`',
    indexes: [
      { name: 'pk_assignment', fields: ['id'], unique: true, description: 'Primary key.' },
      { name: 'ix_assignment_subject', fields: ['subject', 'active'], description: "Resolve a user's active teams." },
      { name: 'ix_assignment_team', fields: ['teamId', 'active'], description: 'List active members of a team.' },
    ],
    immutable: false,
    appendOnly: false,
    schemaVersioned: true,
    retention: ARCHIVE_ON_REMOVAL,
    concurrency: 'OPTIMISTIC_REVISION',
  },
  updates: {
    name: 'updates',
    purpose: 'One mutable draft aggregate per team/checkpoint (R11.1, R11.5).',
    partitionKeyPath: '/programmeId',
    subKeyPath: '/teamId',
    idStrategy: '`${teamId}|${sprintId}|${checkpointId}`',
    indexes: [
      { name: 'pk_update', fields: ['id'], unique: true, description: 'Deterministic aggregate key (at most one draft).' },
      {
        name: 'ix_update_leadership',
        fields: ['programmeId', 'sprintId', 'checkpointId', 'streamId', 'state'],
        description: 'Leadership View grid + state filter without payload access (R12, R13).',
      },
      { name: 'ix_update_rag', fields: ['rag.business', 'rag.delivery', 'rag.release'], description: 'RAG filters from the envelope (R13.1).' },
      { name: 'ix_update_flags', fields: ['hasBlocker', 'hasLeadershipAsk'], description: 'Blocker / leadership-ask filters and summary counts (R13.3).' },
    ],
    immutable: false,
    appendOnly: false,
    schemaVersioned: true,
    retention: ARCHIVE_ON_REMOVAL,
    concurrency: 'OPTIMISTIC_REVISION',
  },
  updateVersions: {
    name: 'updateVersions',
    purpose: 'Immutable submitted snapshots; append-only, retained forever (R2.2, R11.2, R14.1).',
    partitionKeyPath: '/programmeId',
    subKeyPath: '/teamId',
    idStrategy: '`${teamId}|${sprintId}|${checkpointId}|v${versionNumber}`',
    indexes: [
      { name: 'pk_version', fields: ['id'], unique: true, description: 'Primary key.' },
      {
        name: 'ix_version_history',
        fields: ['teamId', 'sprintId', 'checkpointId', 'versionNumber'],
        description: 'Version history + field-by-field comparison (R14.3).',
      },
      { name: 'ix_version_leadership', fields: ['programmeId', 'sprintId', 'checkpointId', 'streamId'], description: 'Resolve the exact submitted version for a leadership cell (R12.3).' },
    ],
    immutable: true,
    appendOnly: true,
    schemaVersioned: true,
    retention: RETAIN,
    concurrency: 'APPEND_ONLY',
  },
  decisions: {
    name: 'decisions',
    purpose: 'Leadership decisions against a submitted version; never edits the ask (R10.3, R14.1).',
    partitionKeyPath: '/programmeId',
    subKeyPath: null,
    idStrategy: 'server-generated ULID',
    indexes: [
      { name: 'pk_decision', fields: ['id'], unique: true, description: 'Primary key.' },
      { name: 'ix_decision_version', fields: ['updateVersionId', 'createdAt'], description: 'Decisions for a specific submitted version.' },
      { name: 'ix_decision_status', fields: ['status', 'dueDate'], description: 'Open decisions and their due dates.' },
    ],
    immutable: false,
    appendOnly: true,
    schemaVersioned: true,
    retention: RETAIN,
    concurrency: 'APPEND_ONLY',
  },
  auditEvents: {
    name: 'auditEvents',
    purpose: 'Append-only audit trail; append-only to application users, separate access (R14.2, R14.4, §13).',
    partitionKeyPath: '/programmeId',
    subKeyPath: null,
    idStrategy: 'server-generated ULID',
    indexes: [
      { name: 'pk_audit', fields: ['id'], unique: true, description: 'Primary key.' },
      { name: 'ix_audit_entity', fields: ['entityType', 'entityId', 'timestamp'], description: 'Audit trail for an entity, chronological.' },
      { name: 'ix_audit_correlation', fields: ['correlationId'], description: 'Correlate an atomic submit + audit write.' },
    ],
    immutable: true,
    appendOnly: true,
    schemaVersioned: true,
    retention: RETAIN,
    concurrency: 'APPEND_ONLY',
  },
};

// ---------------------------------------------------------------------------
// Schema-version compatibility (read-time upcasting, no bulk rewrite)
// ---------------------------------------------------------------------------

/** Current payload contract version. Single source of truth in config.ts. */
export const CURRENT_PAYLOAD_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

/**
 * An upcaster promotes a document persisted at `fromVersion` to `toVersion`.
 * Upcasting happens at *read time* only — stored documents are never bulk
 * rewritten (design.md §4a schema-version strategy).
 */
export interface PayloadUpcaster {
  fromVersion: number;
  toVersion: number;
  /** Pure transform; must not mutate its input. */
  upcast(raw: unknown): unknown;
}

/**
 * Reads a persisted payload of any known `schemaVersion` and returns the
 * current in-memory domain shape. Implementations chain registered upcasters
 * from the stored version up to `current`, then validate with the current Zod
 * schema (validation stays explicit regardless of the store, design.md §4a).
 */
export interface PayloadReadAdapter<TCurrent = UpdatePayload> {
  readonly current: number;
  register(upcaster: PayloadUpcaster): void;
  read(schemaVersion: number, raw: unknown): TCurrent;
}

/**
 * Ordered chain of upcasters. `assertReadable` guards against reading a
 * document written by a newer application version than this reader knows about
 * (which must never be silently coerced).
 */
export function buildUpcastChain(
  storedVersion: number,
  current: number,
  upcasters: readonly PayloadUpcaster[],
): PayloadUpcaster[] {
  if (storedVersion > current) {
    throw new Error(
      `Document schemaVersion ${storedVersion} is newer than the reader (${current}); refuse to downgrade.`,
    );
  }
  const chain: PayloadUpcaster[] = [];
  let at = storedVersion;
  while (at < current) {
    const step = upcasters.find((u) => u.fromVersion === at);
    if (!step) {
      throw new Error(`No upcaster registered from schemaVersion ${at}.`);
    }
    chain.push(step);
    at = step.toVersion;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Concurrency + immutability + atomic-write contracts
// ---------------------------------------------------------------------------

/**
 * The write-precondition contract for optimistic concurrency. A write carries
 * the `revision` the client last read; the store rejects it (409) when the
 * stored revision differs, overwriting nothing (R11.5). On success the stored
 * revision is incremented by one.
 */
export interface OptimisticWriteGuard {
  /** Revision the client believes is current. */
  expectedRevision: number;
}

/**
 * Result of an optimistic write. On conflict the store returns its current
 * envelope snapshot so the UI can surface who changed it and when — mirrored by
 * RevisionConflictError in repository.ts and the 409 RevisionConflict response
 * in the OpenAPI contract.
 */
export type WriteOutcome<TDoc> =
  | { ok: true; document: TDoc }
  | {
      ok: false;
      conflict: true;
      server: { revision: number; updatedAt: string; updatedBy: string };
    };

/**
 * Submission is a single atomic unit: append the immutable version AND append
 * the audit event AND update the draft envelope to SUBMITTED, or nothing. All
 * three documents share `programmeId` as the partition key so the store can do
 * this in one single-partition transaction/batch (design.md §4a guarantees,
 * R11.2, R14.1).
 */
export interface AtomicSubmitBatch {
  version: UpdateVersionRecord; // insert (append-only)
  audit: AuditRecord; // insert (append-only)
  draft: UpdateRecord; // upsert -> state SUBMITTED, revision + 1
  partitionKey: string; // === programmeId for all three
}

/** Collections whose documents must never be updated in place. */
export const IMMUTABLE_COLLECTIONS: readonly CollectionName[] = Object.values(PERSISTENCE_MODEL)
  .filter((c) => c.immutable)
  .map((c) => c.name);

/** Collections that only ever accept inserts. */
export const APPEND_ONLY_COLLECTIONS: readonly CollectionName[] = Object.values(PERSISTENCE_MODEL)
  .filter((c) => c.appendOnly)
  .map((c) => c.name);

/**
 * The partition key value for any document is always its programmeId. Phase A
 * is a single programme; the key still applies uniformly for forward
 * compatibility.
 */
export function partitionKeyFor(programmeId: string = PROGRAMME_ID): string {
  return programmeId;
}
