/**
 * Application configuration. These are configurable seed/admin values, not
 * hard-coded business rules (requirements.md §4, product decision: cadence).
 */
export const PROGRAMME_ID = 'vsdd';
export const PROGRAMME_NAME = 'VSDD';

/**
 * Timestamps are stored in UTC. Display/reporting uses Europe/Dublin by
 * default, but the timezone is configurable.
 */
export const DEFAULT_TIMEZONE = 'Europe/Dublin';

/** Current document schema version (design.md §4a schema-version strategy). */
export const CURRENT_SCHEMA_VERSION = 1;
