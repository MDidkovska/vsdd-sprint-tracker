/**
 * PoC backend configuration.
 *
 * Values come from the environment (see `.env.example`). Sensible localhost
 * defaults keep the PoC runnable without a `.env` file. No secrets are stored
 * in code; authentication is intentionally absent for the PoC (design.md §4b).
 */

export interface ServerConfig {
  host: string;
  port: number;
  mongoUri: string;
  mongoDb: string;
  logLevel: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT, 8080),
    mongoUri: env.MONGO_URI ?? 'mongodb://localhost:27017',
    mongoDb: env.MONGO_DB ?? 'vsdd_sprint_tracker',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
