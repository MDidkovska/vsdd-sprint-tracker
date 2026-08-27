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
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import type {
  AuditEvent,
  UpdateDocument,
  UpdateVersion,
} from '../domain/documents.js';
import type {
  DocumentRepository,
  SaveDraftInput,
  WriteOutcome,
} from './documentRepository.js';
import { ImmutableViolationError, RepositoryError } from './errors.js';

export interface MongoDocumentRepositoryConfig {
  uri: string;
  dbName: string;
}

const COLLECTIONS = {
  updates: 'updates',
  updateVersions: 'updateVersions',
  auditEvents: 'auditEvents',
} as const;

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

/** Drop MongoDB's physical `_id` so callers only ever see domain shapes. */
function stripId<T extends Document>(raw: T): Omit<T, '_id'> {
  const { _id, ...rest } = raw as T & { _id?: unknown };
  void _id;
  return rest;
}

export class MongoDocumentRepository implements DocumentRepository {
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
  }

  async ping(): Promise<boolean> {
    const result = await this.db.command({ ping: 1 });
    return result?.ok === 1;
  }

  async getDraft(id: string): Promise<UpdateDocument | null> {
    const raw = await this.updates.findOne({ id });
    return raw ? (stripId(raw) as UpdateDocument) : null;
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

  async close(): Promise<void> {
    await this.client.close();
  }
}
