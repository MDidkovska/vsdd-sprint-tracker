/**
 * Interactive first-Admin bootstrap CLI (Phase 8, task 8.7).
 *
 *   npm run bootstrap-admin
 *
 * Prompts for the admin's email, display name and password. The password is
 * read WITHOUT echoing to the terminal and is never passed as a command-line
 * argument, so it never lands in shell history or source control
 * (requirements.md R1a.5). The heavy lifting (and idempotency) lives in the
 * testable {@link bootstrapAdmin} core; this wrapper only handles I/O and the
 * database connection.
 */
import * as readline from 'node:readline';
import { Argon2idHasher } from '../auth/passwordHasher.js';
import { loadConfig } from '../config.js';
import { PROGRAMME_ID } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { bootstrapAdmin } from '../services/bootstrapAdmin.js';

/** Ask a visible question and resolve with the trimmed answer. */
function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, (answer) => resolve(answer.trim())));
}

/**
 * Ask for a secret without echoing keystrokes. Overrides readline's output
 * writer so typed characters never render, then restores a normal prompt.
 */
function askHidden(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const rlx = rl as unknown as { _writeToOutput: (s: string) => void };
  let promptWritten = false;
  rlx._writeToOutput = (str: string): void => {
    if (!promptWritten) {
      process.stdout.write(query);
      promptWritten = true;
      return;
    }
    // Swallow echoed keystrokes so the password is never shown. Preserve a
    // newline when the user submits.
    if (str.includes('\n')) process.stdout.write('\n');
  };
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('VSDD Sprint Tracker — create the first Admin account.\n');
  const email = await ask(rl, 'Admin email: ');
  const displayName = await ask(rl, 'Display name: ');
  rl.close();

  const password = await askHidden('Password (min 10 chars, hidden): ');
  const confirm = await askHidden('Confirm password: ');
  if (password !== confirm) {
    console.error('\nPasswords do not match. Aborting; no account was created.');
    process.exit(1);
  }

  const repository = await MongoDocumentRepository.connect({
    uri: config.mongoUri,
    dbName: config.mongoDb,
  });

  try {
    const result = await bootstrapAdmin(
      { identity: repository, hasher: new Argon2idHasher() },
      { email, displayName, password, programmeId: PROGRAMME_ID },
    );
    if (result.created) {
      console.log(`\nCreated Admin account for ${result.email} (id ${result.userId}).`);
    } else {
      console.log(`\n${result.reason ?? 'Nothing to do.'}`);
    }
  } catch (error) {
    console.error(`\nFailed to create the admin account: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await repository.close();
  }
}

void main();
