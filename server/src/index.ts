/**
 * PoC backend entrypoint.
 *
 * Wires the MongoDB document adapter to the Fastify infrastructure server and
 * starts listening. The server binds the readiness probe to the adapter's
 * `ping()`, so `/ready` reflects real document-store connectivity.
 *
 * Phase 8 wires LOCAL account authentication: the Argon2id hasher, rate
 * limiters, the auth + admin services and the session authenticator. Business
 * services resolve the authenticated principal through the request-scoped auth
 * context (populated per request by the authentication hook), so they never
 * learn whether the principal came from a local session or (later) an OIDC
 * token (design.md §5a).
 *
 * Graceful shutdown closes the HTTP server and the Mongo connection pool.
 */
import { SessionAuthenticator } from './auth/authenticator.js';
import { Argon2idHasher } from './auth/passwordHasher.js';
import { RateLimiter } from './auth/rateLimiter.js';
import { requestAuthContext } from './auth/requestContext.js';
import { loadConfig } from './config.js';
import { buildReferenceData } from './reference/referenceData.js';
import { MongoDocumentRepository } from './repository/mongoDocumentRepository.js';
import { buildServer } from './server.js';
import { AdminService } from './services/adminService.js';
import { HierarchyAdminService } from './services/hierarchyAdminService.js';
import { AuditQueryService } from './services/auditService.js';
import { AuthService } from './services/authService.js';
import { DecisionService } from './services/decisionService.js';
import { DraftService } from './services/draftService.js';
import { ExportService } from './services/exportService.js';
import { HierarchyService } from './services/hierarchyService.js';
import { NotificationService } from './services/notificationService.js';
import { ReopenService } from './services/reopenService.js';
import { SubmitService } from './services/submitService.js';
import { SummaryService } from './services/summaryService.js';
import { VersionService } from './services/versionService.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();

  const repository = await MongoDocumentRepository.connect({
    uri: config.mongoUri,
    dbName: config.mongoDb,
  });

  // Seed the reference/config dataset (hierarchy + reporting cycle). Idempotent,
  // so restarts never duplicate documents (design.md §4a).
  await repository.seedReferenceData(buildReferenceData());

  // Local-account authentication stack (Phase 8). The business services resolve
  // the authenticated subject through the request-scoped auth context.
  const hasher = new Argon2idHasher();
  const authService = new AuthService({
    identity: repository,
    hasher,
    registerLimiter: new RateLimiter({ max: 5, windowMs: FIFTEEN_MINUTES_MS }),
    loginLimiter: new RateLimiter({ max: 10, windowMs: FIFTEEN_MINUTES_MS }),
    sessionTtlMs: config.sessionTtlHours * 3600 * 1000,
  });
  const adminService = new AdminService({
    identity: repository,
    reference: repository,
    auth: requestAuthContext,
  });
  const auditQuery = new AuditQueryService(repository, requestAuthContext);
  const authenticator = new SessionAuthenticator(repository, repository, repository);

  const hierarchy = new HierarchyService(repository, requestAuthContext);
  const drafts = new DraftService(repository, requestAuthContext);
  const submits = new SubmitService(repository, requestAuthContext);
  const reopens = new ReopenService(repository, requestAuthContext);
  const summaries = new SummaryService(repository, requestAuthContext);
  const versions = new VersionService(repository, requestAuthContext);
  const decisions = new DecisionService(repository, requestAuthContext);
  // The export reuses the leadership projection (task 7.7), enforces the same
  // programme permission as the UI (task 7.10, R16.4) and appends an
  // append-only EXPORT_CREATED security-audit event on success (R15).
  const exports = new ExportService(summaries, requestAuthContext, repository);
  // In-app deadline reminders (task 9.1). Reminders are generated lazily and
  // idempotently when the inbox is loaded — no cron/background worker.
  const notifications = new NotificationService(repository, requestAuthContext);
  // Programme hierarchy / reporting-cycle administration (task 9.5). Admin-only;
  // configures streams, teams, sprints and reporting checkpoints without deploy.
  const hierarchyAdmin = new HierarchyAdminService({
    repository,
    auth: requestAuthContext,
  });

  const app = buildServer(
    {
      checkReadiness: () => repository.ping(),
      hierarchy,
      drafts,
      submits,
      reopens,
      summaries,
      versions,
      decisions,
      exports,
      auth: authService,
      admin: adminService,
      hierarchyAdmin,
      auditQuery,
      notifications,
      authenticator,
      authConfig: {
        secureCookies: config.secureCookies,
        sessionTtlSeconds: config.sessionTtlHours * 3600,
      },
    },
    { logLevel: config.logLevel },
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await repository.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start server');
    await repository.close();
    process.exit(1);
  }
}

void main();
