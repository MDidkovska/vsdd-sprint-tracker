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
  /**
   * Whether session cookies are marked `Secure`. Enabled outside local
   * development (requirements.md R1.3): true when NODE_ENV is `production`,
   * overridable via `SECURE_COOKIES`.
   */
  secureCookies: boolean;
  /** Session lifetime in hours (opaque server-side session TTL). */
  sessionTtlHours: number;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
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
    // The local PoC MongoDB runs as a single-node replica set (`rs0`) so that
    // transactional writes (submit / reopen / decision) work. The `replicaSet`
    // parameter is REQUIRED — connecting without it disables transactions.
    mongoUri: env.MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0',
    mongoDb: env.MONGO_DB ?? 'vsdd_sprint_tracker',
    logLevel: env.LOG_LEVEL ?? 'info',
    // Secure outside local development: default on only in production, but
    // explicitly overridable so a non-production deployment can enable it.
    secureCookies: parseBool(env.SECURE_COOKIES, env.NODE_ENV === 'production'),
    sessionTtlHours: parsePositiveInt(env.SESSION_TTL_HOURS, 12),
  };
}
