/**
 * Structured application logger configuration (task 10.2, design.md §2 / §5a).
 *
 * The PoC keeps ONLY structured operational metadata in its application logs:
 * stable ids, the event type / action, the response status and timing. It must
 * NEVER emit a password, a password hash, a raw session token / cookie or any
 * free-text, user-authored update content (goals, achievements, exceptions,
 * leadership asks, reopen reasons, …). Basic latency and error counters are
 * derived from these logs, so they have to stay clean and machine-parseable.
 *
 * Two layers keep secrets out of the log stream:
 *
 *  1. Safe serializers — the `req`/`res`/`err` objects are reduced to a fixed,
 *     allow-listed shape. The request serializer emits the method, url and
 *     transport metadata only; it never touches `req.headers` or `req.body`, so
 *     the session cookie, the `Authorization` header, the CSRF token and any
 *     request payload (credentials, draft content) simply never enter a log
 *     line. The response serializer emits the status code only, so `set-cookie`
 *     is never logged. The error serializer emits a fixed set of fields (type,
 *     message, stable code, status, stack, and field-error PATHS — never field
 *     VALUES), so an error object can never smuggle a body or credential into
 *     the stream.
 *
 *  2. Redaction — a defensive `redact` list censors well-known sensitive paths
 *     even if a future call site logs an ad-hoc object. This is belt-and-braces
 *     on top of the serializers above.
 *
 * Fastify's default request/response logging is retained (it already omits
 * bodies and headers); we deliberately do NOT enable body logging anywhere, and
 * especially not for the auth or draft/update endpoints.
 */
import type { FastifyServerOptions } from 'fastify';

/**
 * The censor string substituted for any redacted value. Kept human-readable so
 * an operator can see that a field was intentionally removed rather than empty.
 */
export const LOG_REDACTION_CENSOR = '[REDACTED]';

/**
 * Sensitive log paths that are censored as a defensive backstop. The serializers
 * already prevent headers/bodies from being logged; these paths additionally
 * cover any ad-hoc object a call site might log now or in the future. Absent
 * paths are simply ignored by the logger, so listing them is always safe.
 */
export const SENSITIVE_LOG_PATHS: string[] = [
  // Sensitive request headers — the session cookie, bearer auth and CSRF token.
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  // The response set-cookie carries the freshly minted session token.
  'res.headers["set-cookie"]',
  // Credentials and session material, at the top level …
  'password',
  'passwordHash',
  'token',
  'sessionToken',
  // … or nested one level inside an ad-hoc logged object.
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.sessionToken',
];

interface SerializedFieldError {
  path: string;
  message: string;
}

interface SerializedError {
  type: string;
  message: string;
  code?: unknown;
  statusCode?: unknown;
  stack?: string;
  fieldErrors?: SerializedFieldError[];
}

/**
 * Reduce an error to a fixed, safe shape. Emits the error type, its user-facing
 * message, the stable API code/status (when present) and the stack. Field
 * errors are reduced to their PATH + validation MESSAGE only — never the
 * rejected value — so a validation failure on a password or free-text field can
 * never leak the value that was submitted.
 */
export function serializeError(error: unknown): SerializedError {
  const err = error as {
    name?: string;
    message?: string;
    stack?: string;
    code?: unknown;
    statusCode?: unknown;
    fieldErrors?: Array<{ path?: unknown; message?: unknown }>;
  };

  const serialized: SerializedError = {
    type: typeof err?.name === 'string' ? err.name : 'Error',
    message: typeof err?.message === 'string' ? err.message : String(error),
  };

  if (err?.code !== undefined) serialized.code = err.code;
  if (err?.statusCode !== undefined) serialized.statusCode = err.statusCode;
  if (typeof err?.stack === 'string') serialized.stack = err.stack;
  if (Array.isArray(err?.fieldErrors)) {
    serialized.fieldErrors = err.fieldErrors.map((fieldError) => ({
      path: String(fieldError?.path ?? ''),
      message: String(fieldError?.message ?? ''),
    }));
  }

  return serialized;
}

/**
 * Reduce a request to structured operational metadata only. NEVER reads
 * `req.headers` or `req.body`, so cookies, tokens and request payloads cannot
 * be logged. The url retains path + query (stable ids and filter ids), which is
 * exactly the operational metadata the observability counters need.
 */
function serializeRequest(request: {
  method?: string;
  url?: string;
  ip?: string;
  socket?: { remotePort?: number };
}): Record<string, unknown> {
  return {
    method: request.method,
    url: request.url,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

/** Reduce a reply to its status code only (never headers, so no set-cookie). */
function serializeReply(reply: { statusCode?: number }): Record<string, unknown> {
  return { statusCode: reply.statusCode };
}

/**
 * Build the Fastify/pino logger options for the PoC: a level, the defensive
 * redaction list and the safe serializers described above. Callers may pass a
 * destination `stream` (used by tests to capture the structured output).
 */
export function buildLoggerOptions(
  level: string,
  stream?: NodeJS.WritableStream,
): FastifyServerOptions['logger'] {
  const options: Record<string, unknown> = {
    level,
    redact: {
      paths: SENSITIVE_LOG_PATHS,
      censor: LOG_REDACTION_CENSOR,
    },
    serializers: {
      req: serializeRequest,
      res: serializeReply,
      err: serializeError,
    },
  };
  if (stream) {
    options.stream = stream;
  }
  return options as FastifyServerOptions['logger'];
}
