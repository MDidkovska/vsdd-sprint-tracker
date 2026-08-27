/**
 * Fastify application factory.
 *
 * Exposes ONLY infrastructure endpoints for the PoC scaffold:
 *  - GET /health — liveness. Answers without touching the database, so an
 *    orchestrator can tell the process is up even while a dependency is down.
 *  - GET /ready  — readiness. Verifies document-store connectivity via the
 *    injected checker and returns 503 when the store is unreachable.
 *
 * Task 7.3 adds the first business read endpoints (programme hierarchy and
 * reporting cycle). They are registered only when a {@link HierarchyApi} is
 * injected, so infrastructure-only tests still build the server without it.
 * Authentication remains mocked (Phase 8). Readiness and the business API are
 * injected as plain contracts so the server never depends on MongoDB directly
 * (vendor-neutral boundary).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import {
  ApiError,
  newCorrelationId,
  toErrorEnvelope,
  type ApiErrorCode,
} from './http/errorEnvelope.js';
import { registerHierarchyRoutes } from './routes/hierarchyRoutes.js';
import type { HierarchyApi } from './services/hierarchyService.js';

export interface ServerDeps {
  /** Returns true when the document store is reachable. May throw on failure. */
  checkReadiness(): Promise<boolean>;
  /**
   * The hierarchy/identity read API (task 7.3). Optional so infrastructure-only
   * scaffolds/tests can build a server without the business layer.
   */
  hierarchy?: HierarchyApi;
}

export interface BuildServerOptions {
  logLevel?: string;
}

export function buildServer(
  deps: ServerDeps,
  options: BuildServerOptions = {},
): FastifyInstance {
  const app = Fastify({
    logger: { level: options.logLevel ?? 'info' },
  });

  // Serialise every thrown error to the §6 error envelope. A known ApiError
  // keeps its stable code/status; anything else is a 500 SAVE_FAILED with
  // user-facing copy (never a raw stack trace).
  app.setErrorHandler((error, request, reply) => {
    const correlationId = newCorrelationId();
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, correlationId }, 'request failed');
      } else {
        request.log.info({ code: error.code, correlationId }, 'request rejected');
      }
      reply.code(error.statusCode);
      return toErrorEnvelope(error.code, error.message, correlationId, error.fieldErrors);
    }

    // Fastify's own validation errors (e.g. malformed query) -> 400.
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const code: ApiErrorCode = status === 400 ? 'VALIDATION_FAILED' : 'SAVE_FAILED';
    request.log.error({ err: error, correlationId }, 'unhandled request error');
    reply.code(status >= 400 && status < 600 ? status : 500);
    const message =
      status === 400
        ? 'The request was invalid. Check the request and try again.'
        : 'Something needs attention on the server. Please try again shortly.';
    return toErrorEnvelope(code, message, correlationId);
  });

  // Liveness: the process is running. Never depends on the database.
  app.get('/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness: safe to receive traffic only when the document store answers.
  app.get('/ready', async (_request, reply) => {
    try {
      const ready = await deps.checkReadiness();
      if (ready) {
        return { status: 'ready', timestamp: new Date().toISOString() };
      }
    } catch (error) {
      app.log.warn({ err: error }, 'readiness check failed');
    }
    reply.code(503);
    return { status: 'not_ready', timestamp: new Date().toISOString() };
  });

  // Business read endpoints (task 7.3), registered only when wired.
  if (deps.hierarchy) {
    registerHierarchyRoutes(app, deps.hierarchy);
  }

  return app;
}
