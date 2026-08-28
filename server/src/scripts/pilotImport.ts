/**
 * Controlled-pilot import CLI (Phase 11, task 11.1).
 *
 *   npm run pilot-import              # DRY-RUN (default): report the plan only
 *   npm run pilot-import -- --apply   # APPLY: perform the idempotent writes
 *
 * Dry-run is the DEFAULT and performs no writes: it prints exactly what an apply
 * would create / update / leave unchanged. Apply performs the same plan
 * idempotently — re-running never duplicates a record and never silently
 * overwrites one.
 *
 * Newly-created accounts get the password from `PILOT_DEFAULT_PASSWORD` (never
 * committed to source and never echoed). Re-runs never touch credentials, so the
 * variable is only required for an apply that would create at least one account.
 * The heavy lifting (and idempotency) lives in the testable
 * {@link PilotImportService}; this wrapper only handles args, env and the
 * database connection.
 */
import { Argon2idHasher } from '../auth/passwordHasher.js';
import { loadConfig } from '../config.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import {
  PilotImportService,
  type PilotImportResult,
  type PilotPlanEntry,
} from '../services/pilotImport.js';

const MIN_PASSWORD = 10;

function parseApply(argv: string[]): boolean {
  return argv.includes('--apply');
}

function actionSymbol(entry: PilotPlanEntry): string {
  switch (entry.action) {
    case 'create':
      return '+ create';
    case 'update':
      return '~ update';
    default:
      return '= no-op ';
  }
}

function printPlan(result: PilotImportResult): void {
  const mode = result.dryRun ? 'DRY-RUN (no writes performed)' : 'APPLY';
  console.log(`\nVSDD controlled-pilot import — ${mode}\n`);
  for (const entry of result.entries) {
    const detail = entry.detail ? `  (${entry.detail})` : '';
    console.log(`  ${actionSymbol(entry)}  ${entry.kind.padEnd(10)} ${entry.label}${detail}`);
  }
  const { create, update, noop, total } = result.summary;
  console.log(
    `\n  ${total} record(s): ${create} to create, ${update} to update, ${noop} unchanged.`,
  );
  if (result.dryRun) {
    console.log('\n  Re-run with `-- --apply` to perform these changes.\n');
  } else {
    console.log('\n  Import complete.\n');
  }
}

async function main(): Promise<void> {
  const apply = parseApply(process.argv.slice(2));
  const config = loadConfig();
  const password = process.env.PILOT_DEFAULT_PASSWORD ?? '';

  // For an apply we may create accounts, which requires a valid default
  // password. Fail fast before touching the database.
  if (apply && password.length < MIN_PASSWORD) {
    console.error(
      `\nPILOT_DEFAULT_PASSWORD must be set to at least ${MIN_PASSWORD} characters for an apply.\n` +
        'It is used only for accounts this run creates, is never stored in source and is never echoed.\n',
    );
    process.exit(1);
  }

  const repository = await MongoDocumentRepository.connect({
    uri: config.mongoUri,
    dbName: config.mongoDb,
  });

  try {
    const service = new PilotImportService({
      repository,
      hasher: new Argon2idHasher(),
      defaultPassword: password,
    });
    const result = await service.run({ dryRun: !apply });
    printPlan(result);
  } catch (error) {
    console.error(`\nPilot import failed: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await repository.close();
  }
}

void main();
