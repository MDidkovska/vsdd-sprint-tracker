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
import type { RequestAuthenticator } from './auth/authenticator.js';
import { registerCsrfProtection } from './auth/csrf.js';
import { authorizeRoute, classifyRoute } from './auth/httpAuth.js';
import { runWithPrincipal } from './auth/requestContext.js';
import { readSessionToken } from './auth/session.js';
import { registerSecurityHeaders } from './http/securityHeaders.js';
import {
  ApiError,
  DraftRevisionConflictError,
  newCorrelationId,
  toErrorEnvelope,
  type ApiErrorCode,
} from './http/errorEnvelope.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { registerAuditRoutes } from './routes/auditRoutes.js';
import { registerAuthRoutes, type AuthRoutesConfig } from './routes/authRoutes.js';
import { registerDecisionRoutes } from './routes/decisionRoutes.js';
import { registerDraftRoutes } from './routes/draftRoutes.js';
import { registerExportRoutes } from './routes/exportRoutes.js';
import { registerHierarchyRoutes } from './routes/hierarchyRoutes.js';
import { registerHierarchyAdminRoutes } from './routes/hierarchyAdminRoutes.js';
import { registerNotificationRoutes } from './routes/notificationRoutes.js';
import { registerReopenRoutes } from './routes/reopenRoutes.js';
import { registerSubmitRoutes } from './routes/submitRoutes.js';
import { registerSummaryRoutes } from './routes/summaryRoutes.js';
import { registerVersionRoutes } from './routes/versionRoutes.js';
import type { AdminApi } from './services/adminService.js';
import type { AuditApi } from './services/auditService.js';
import type { AuthApi } from './services/authService.js';
import type { DecisionApi } from './services/decisionService.js';
import type { DraftApi } from './services/draftService.js';
import type { ExportApi } from './services/exportService.js';
import type { HierarchyApi } from './services/hierarchyService.js';
import type { HierarchyAdminApi } from './services/hierarchyAdminService.js';
import type { NotificationApi } from './services/notificationService.js';
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
  /**
   * The local-account authentication API (task 8.1). Optional; registers
   * POST /auth/register, /auth/login and /auth/logout.
   */
  auth?: AuthApi;
  /**
   * The admin approval/assignment API (task 8.2). Optional; registers the
   * /admin/users endpoints.
   */
  admin?: AdminApi;
  /**
   * The programme hierarchy / reporting-cycle admin API (task 9.5). Optional;
   * registers the /admin/streams, /admin/teams, /admin/sprints and
   * /admin/checkpoints configuration endpoints (Admin only).
   */
  hierarchyAdmin?: HierarchyAdminApi;
  /**
   * The read-only audit-history API (Phase 8 repair). Optional; registers
   * GET /audit (Admin/Auditor).
   */
  auditQuery?: AuditApi;
  /**
   * The in-app notification API (task 9.1). Optional; registers
   * GET /notifications, POST /notifications/:id/read and
   * POST /notifications/read-all. Reminders are generated lazily on inbox load.
   */
  notifications?: NotificationApi;
  /**
   * The request authenticator (task 8.1/8.4). When provided, a global
   * authentication hook resolves the session cookie into a request-scoped
   * principal and enforces default-deny access (401 unauthenticated, 403
   * unauthorised). When absent (infrastructure/endpoint unit tests) no hook is
   * registered and services use whatever AuthContext they were built with.
   */
  authenticator?: RequestAuthenticator;
  /** Session cookie settings used by the auth routes. */
  authConfig?: AuthRoutesConfig;
  /**
   * Enable CSRF double-submit protection for state-changing requests (task
   * 10.1). Enabled by the real composition root (index.ts); left off for
   * endpoint unit tests that inject routes directly without a browser client.
   * The dedicated CSRF tests opt in explicitly.
   */
  csrfProtection?: boolean;
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

  // Minimal security headers (task 10.1): a lean CSP plus companions on every
  // response. Additive and HTTPS-independent, so it never breaks plain-HTTP
  // local development or the separately-served Vite dev app.
  registerSecurityHeaders(app);

  // CSRF double-submit protection (task 10.1). Registered BEFORE the auth hook
  // so a forged state-changing request is rejected before any session lookup.
  // The token cookie's Secure flag tracks the session cookie so plain-HTTP local
  // dev keeps working.
  if (deps.csrfProtection) {
    registerCsrfProtection(app, {
      secureCookies: deps.authConfig?.secureCookies ?? false,
    });
  }

  // Authentication + edge authorisation hook (task 8.1/8.4). Registered only
  // when an authenticator is wired. It resolves the session cookie into a
  // request-scoped principal and applies default-deny access: unauthenticated
  // requests on protected routes are 401; non-ACTIVE accounts reaching
  // programme data are 403; admin/leadership route gates are applied here while
  // fine-grained team/role scoping stays inside the services.
  if (deps.authenticator) {
    const authenticator = deps.authenticator;
    // Callback-style hook: we authenticate asynchronously, then continue the
    // rest of the request lifecycle INSIDE `runWithPrincipal(...)` so the
    // request-scoped principal reliably propagates from this hook into the
    // route handler (AsyncLocalStorage.run, not enterWith). Auth/authorisation
    // failures reject and are routed to the shared error handler via done(err).
    app.addHook('onRequest', (request, _reply, done) => {
      const routeClass = classifyRoute(request.method, request.url);
      if (routeClass === 'public') {
        done();
        return;
      }

      const token = readSessionToken(request.headers.cookie);
      authenticator
        .authenticate(token)
        .then((principal) => {
          if (!principal) {
            throw new ApiError(
              'SESSION_EXPIRED',
              'Your session has expired. Please sign in again.',
            );
          }
          if (routeClass === 'authed-active' && principal.status !== 'ACTIVE') {
            throw new ApiError(
              'PERMISSION_DENIED',
              'Your account is not active yet. Access is not permitted.',
            );
          }
          if (routeClass === 'authed-active') {
            authorizeRoute(principal, request.method, request.url);
          }
          // Continue the lifecycle within the principal's async context.
          runWithPrincipal(principal, done);
        })
        .catch((error: unknown) => done(error as Error));
    });
  }

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

  // Local-account authentication endpoints (task 8.1), registered only when wired.
  if (deps.auth) {
    registerAuthRoutes(
      app,
      deps.auth,
      deps.authConfig ?? { secureCookies: true, sessionTtlSeconds: 12 * 3600 },
    );
  }

  // Admin approval/assignment endpoints (task 8.2), registered only when wired.
  if (deps.admin) {
    registerAdminRoutes(app, deps.admin);
  }

  // Programme hierarchy / reporting-cycle admin endpoints (task 9.5), when wired.
  if (deps.hierarchyAdmin) {
    registerHierarchyAdminRoutes(app, deps.hierarchyAdmin);
  }

  // Read-only audit-history endpoint (Phase 8 repair), registered when wired.
  if (deps.auditQuery) {
    registerAuditRoutes(app, deps.auditQuery);
  }

  // In-app notification endpoints (task 9.1), registered only when wired.
  if (deps.notifications) {
    registerNotificationRoutes(app, deps.notifications);
  }

  return app;
}
