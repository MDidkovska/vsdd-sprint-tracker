/**
 * Vendor-neutral repository errors.
 *
 * These mirror the frontend `RepositoryError` / `RevisionConflictError`
 * (`src/api/repository.ts`) so the eventual HTTP API can map them to the same
 * stable error codes and the §6 error envelope. No MongoDB-specific error ever
 * escapes the adapter — it is translated into one of these.
 */

export type RepositoryErrorCode =
  | 'DRAFT_REVISION_CONFLICT'
  | 'IMMUTABLE_VIOLATION'
  | 'DUPLICATE_KEY'
  | 'NOT_FOUND'
  | 'SAVE_FAILED';

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

/**
 * Thrown/returned when an optimistic write uses a stale revision. Carries the
 * current server envelope metadata so the caller (and later the UI) can show
 * who changed the document and when — never a silent last-write-wins.
 */
export class RevisionConflictError extends RepositoryError {
  readonly serverRevision: number;
  readonly serverUpdatedAt: string;
  readonly serverUpdatedBy: string;

  constructor(server: { revision: number; updatedAt: string; updatedBy: string }) {
    super(
      'DRAFT_REVISION_CONFLICT',
      'This draft changed after you opened it. Review the latest version before saving.',
    );
    this.name = 'RevisionConflictError';
    this.serverRevision = server.revision;
    this.serverUpdatedAt = server.updatedAt;
    this.serverUpdatedBy = server.updatedBy;
  }
}

/** Thrown when an append-only / immutable document is written more than once. */
export class ImmutableViolationError extends RepositoryError {
  constructor(message = 'This document is immutable and cannot be modified.') {
    super('IMMUTABLE_VIOLATION', message);
    this.name = 'ImmutableViolationError';
  }
}

/**
 * Thrown when a unique-keyed insert collides with an existing document (e.g. a
 * duplicate user email under a race). Vendor-neutral: the service layer maps it
 * to the appropriate domain error (e.g. EMAIL_TAKEN).
 */
export class DuplicateKeyError extends RepositoryError {
  constructor(message = 'A record with this key already exists.') {
    super('DUPLICATE_KEY', message);
    this.name = 'DuplicateKeyError';
  }
}
