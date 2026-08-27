/**
 * Fastify application factory.
 *
 * Exposes ONLY infrastructure endpoints for the PoC scaffold:
 *  - GET /health — liveness. Answers without touching the database, so an
 *    orchestrator can tell the process is up even while a dependency is down.
 *  - GET /ready  — readiness. Verifies document-store connectivity via the
 *    injected checker and returns 503 when the store is unreachable.
 *
 * NO business API endpoints and NO authentication are defined here — those are
 * later tasks (7.3–7.11, Phase 8). Readiness is injected as a plain function so
 * the server never depends on MongoDB directly (vendor-neutral boundary).
 */
import Fastify, { type FastifyInstance } from 'fastify';

export interface ServerDeps {
  /** Returns true when the document store is reachable. May throw on failure. */
  checkReadiness(): Promise<boolean>;
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

  return app;
}
