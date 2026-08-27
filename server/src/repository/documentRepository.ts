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
 * Business operations (hierarchy reads, submit orchestration, reopen, leadership
 * projections, export …) are deliberately NOT part of this PoC contract — they
 * are later tasks (7.3–7.11). This interface is the storage primitive those
 * endpoints will be built on.
 */
import type {
  AuditEvent,
  UpdateDocument,
  UpdateVersion,
} from '../domain/documents.js';

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

export interface DocumentRepository {
  /**
   * Readiness probe: verifies the underlying store is reachable. Returns true
   * when a round-trip succeeds; throws or returns false otherwise. Used by the
   * `/ready` endpoint — never touches business data.
   */
  ping(): Promise<boolean>;

  /** Read the current mutable draft aggregate by its deterministic id. */
  getDraft(id: string): Promise<UpdateDocument | null>;

  /**
   * Persist the mutable draft under the optimistic-concurrency guard. Returns
   * `{ ok: true }` with the stored document (revision incremented) or
   * `{ ok: false, conflict: true }` with the current server metadata. Never
   * performs a silent last-write-wins overwrite (R11.5).
   */
  saveDraft(input: SaveDraftInput): Promise<WriteOutcome<UpdateDocument>>;

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

  /** Read audit documents for an entity, chronological order. */
  listAudit(entityId: string): Promise<AuditEvent[]>;

  /** Release underlying resources (connection pool). */
  close(): Promise<void>;
}
