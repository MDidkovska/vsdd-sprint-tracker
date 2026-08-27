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
  DraftRevisionConflictError,
  newCorrelationId,
  toErrorEnvelope,
  type ApiErrorCode,
} from './http/errorEnvelope.js';
import { registerDecisionRoutes } from './routes/decisionRoutes.js';
import { registerDraftRoutes } from './routes/draftRoutes.js';
import { registerExportRoutes } from './routes/exportRoutes.js';
import { registerHierarchyRoutes } from './routes/hierarchyRoutes.js';
import { registerReopenRoutes } from './routes/reopenRoutes.js';
import { registerSubmitRoutes } from './routes/submitRoutes.js';
import { registerSummaryRoutes } from './routes/summaryRoutes.js';
import { registerVersionRoutes } from './routes/versionRoutes.js';
import type { DecisionApi } from './services/decisionService.js';
import type { DraftApi } from './services/draftService.js';
import type { ExportApi } from './services/exportService.js';
import type { HierarchyApi } from './services/hierarchyService.js';
import type { ReopenApi } from './services/reopenService.js';
import type { SubmitApi } from './services/submitService.js';
import type { SummaryApi } from './services/summaryService.js';
import type { VersionApi } from './services/versionService.js';

export interface ServerDeps {
  /** Returns true when the document store is reachable. May throw on failure. */
  checkReadiness(): Promise<boolean>;
  /**
   * The hierarchy/identity read API (task 7.3). Optional so infrastructure-only
   * scaffolds/tests can build a server without the business layer.
   */
  hierarchy?: HierarchyApi;
  /**
   * The team-draft read/write API (task 7.4). Optional for the same reason;
   * registers GET /teams/:id/updates/:cp and PUT /teams/:id/drafts/:cp.
   */
  drafts?: DraftApi;
  /**
   * The atomic submit API (task 7.5). Optional for the same reason; registers
   * POST /teams/:id/drafts/:cp/submit.
   */
  submits?: SubmitApi;
  /**
   * The authorised reopen API (task 7.6). Optional for the same reason;
   * registers POST /updates/:versionId/reopen.
   */
  reopens?: ReopenApi;
  /**
   * The leadership summary / filtered projection API (task 7.7). Optional for
   * the same reason; registers
   * GET /programmes/:programmeId/reporting-summary.
   */
  summaries?: SummaryApi;
  /**
   * The version history / audit / comparison API (task 7.8). Optional for the
   * same reason; registers GET /teams/:id/updates/:cp/versions,
   * GET /updates/:versionId, GET /updates/:versionId/audit and
   * GET /updates/:versionId/compare/:compareVersionId.
   */
  versions?: VersionApi;
  /**
   * The leadership decision API (task 7.9). Optional for the same reason;
   * registers POST and GET /updates/:versionId/decisions.
   */
  decisions?: DecisionApi;
  /**
   * The structured export API (task 7.10). Optional for the same reason;
   * registers POST /programmes/:programmeId/exports.
   */
  exports?: ExportApi;
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
      const envelope = toErrorEnvelope(
        error.code,
        error.message,
        correlationId,
        error.fieldErrors,
      );
      // A revision conflict additionally carries the server's current draft
      // metadata so the client can reconcile without a silent overwrite (§6).
      if (error instanceof DraftRevisionConflictError) {
        return { ...envelope, server: error.server };
      }
      return envelope;
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

  // Team-draft read/write endpoints (task 7.4), registered only when wired.
  if (deps.drafts) {
    registerDraftRoutes(app, deps.drafts);
  }

  // Atomic submit endpoint (task 7.5), registered only when wired.
  if (deps.submits) {
    registerSubmitRoutes(app, deps.submits);
  }

  // Authorised reopen endpoint (task 7.6), registered only when wired.
  if (deps.reopens) {
    registerReopenRoutes(app, deps.reopens);
  }

  // Leadership summary / filtered projection endpoint (task 7.7), when wired.
  if (deps.summaries) {
    registerSummaryRoutes(app, deps.summaries);
  }

  // Version history / audit / comparison endpoints (task 7.8), when wired.
  if (deps.versions) {
    registerVersionRoutes(app, deps.versions);
  }

  // Leadership decision endpoints (task 7.9), registered only when wired.
  if (deps.decisions) {
    registerDecisionRoutes(app, deps.decisions);
  }

  // Structured export endpoint (task 7.10), registered only when wired.
  if (deps.exports) {
    registerExportRoutes(app, deps.exports);
  }

  return app;
}
