/**
 * PoC backend entrypoint.
 *
 * Wires the MongoDB document adapter to the Fastify infrastructure server and
 * starts listening. The server binds the readiness probe to the adapter's
 * `ping()`, so `/ready` reflects real document-store connectivity.
 *
 * Graceful shutdown closes the HTTP server and the Mongo connection pool.
 */
import { mockAuthContext } from './auth/mockAuth.js';
import { loadConfig } from './config.js';
import { buildReferenceData } from './reference/referenceData.js';
import { MongoDocumentRepository } from './repository/mongoDocumentRepository.js';
import { buildServer } from './server.js';
import { HierarchyService } from './services/hierarchyService.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const repository = await MongoDocumentRepository.connect({
    uri: config.mongoUri,
    dbName: config.mongoDb,
  });

  // Seed the reference/config dataset (hierarchy + reporting cycle). Idempotent,
  // so restarts never duplicate documents (design.md §4a).
  await repository.seedReferenceData(buildReferenceData());

  // Authentication is mocked for the local PoC (design.md §4b, Phase 8 later).
  const hierarchy = new HierarchyService(repository, mockAuthContext);

  const app = buildServer(
    { checkReadiness: () => repository.ping(), hierarchy },
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
