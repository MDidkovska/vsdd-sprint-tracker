/**
 * HTTP error envelope (design.md §6).
 *
 * Every API error is serialised as `{ error: { code, message, correlationId,
 * fieldErrors } }`. The `code` values match the frontend's stable
 * `RepositoryErrorCode` union (`src/api/repository.ts`) and the OpenAPI
 * `ErrorCode` enum (task 7.1), so the UI can map an error to the same copy and
 * next action regardless of which repository implementation produced it.
 *
 * Messages are user-facing: they explain what happened and the next action.
 * Raw stack traces and generic "something went wrong" copy are never returned.
 */
import { randomUUID } from 'node:crypto';

/** Stable error codes (design.md §6, OpenAPI ErrorCode). */
export type ApiErrorCode =
  | 'DRAFT_REVISION_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'WINDOW_CLOSED'
  | 'ALREADY_SUBMITTED'
  | 'NOT_FOUND'
  | 'SAVE_FAILED'
  | 'VALIDATION_FAILED';

export interface FieldError {
  path: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    correlationId: string;
    fieldErrors: FieldError[];
  };
}

/** Map each stable error code to its HTTP status. */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  ALREADY_SUBMITTED: 409,
  DRAFT_REVISION_CONFLICT: 409,
  WINDOW_CLOSED: 409,
  SAVE_FAILED: 500,
};

/**
 * A domain/API error carrying a stable code, a user-facing message and its HTTP
 * status. Routes throw this; the Fastify error handler serialises it to the §6
 * envelope.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly fieldErrors: FieldError[];

  constructor(code: ApiErrorCode, message: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.fieldErrors = fieldErrors;
  }

  static notFound(message: string): ApiError {
    return new ApiError('NOT_FOUND', message);
  }

  static validation(message: string, fieldErrors: FieldError[] = []): ApiError {
    return new ApiError('VALIDATION_FAILED', message, fieldErrors);
  }
}

/** Build the wire envelope for an error. */
export function toErrorEnvelope(
  code: ApiErrorCode,
  message: string,
  correlationId: string,
  fieldErrors: FieldError[] = [],
): ErrorEnvelope {
  return { error: { code, message, correlationId, fieldErrors } };
}

/** Generate a correlation id for tracing an error through logs. */
export function newCorrelationId(): string {
  return randomUUID();
}
