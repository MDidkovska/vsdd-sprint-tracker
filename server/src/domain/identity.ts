/**
 * Authenticated-identity shapes for the PoC backend.
 *
 * These MIRROR the frontend `CurrentUser` / `Role` contract
 * (`src/api/repository.ts`) and the OpenAPI `CurrentUser` / `Role` schemas
 * (task 7.1). Authentication is intentionally MOCKED for the local PoC
 * (design.md §4b); production enterprise OIDC integration is Phase 8. The
 * `/me` endpoint returns this shape from a mocked authenticated subject.
 */

import type { AccountStatus } from './accounts.js';

export type Role =
  | 'CONTRIBUTOR'
  | 'TEAM_LEAD'
  | 'LEADERSHIP'
  | 'ADMIN'
  | 'AUDITOR';

/** All assignable roles (used to validate admin assignment input). */
export const ROLES: readonly Role[] = [
  'CONTRIBUTOR',
  'TEAM_LEAD',
  'LEADERSHIP',
  'ADMIN',
  'AUDITOR',
];

export interface CurrentUser {
  /**
   * Stable subject id. For the local-account PoC this is the user account id;
   * a future OIDC provider would supply its stable subject claim here instead.
   */
  subject: string;
  /** Account email (also the login identifier). */
  email: string;
  displayName: string;
  initials: string;
  roleLabel: string;
  /**
   * Account lifecycle status. Only `ACTIVE` accounts may reach programme data;
   * `GET /me` returns the principal for any authenticated status so the UI can
   * route `PENDING`/`SUSPENDED`/`REJECTED` users to the right screen (R1.4).
   */
  status: AccountStatus;
  /**
   * The single programme this principal is assigned to (null until assigned).
   * A LEADERSHIP / ADMIN / AUDITOR role applies ONLY to this programme, never
   * globally — every programme-level authorisation check verifies the requested
   * programme id against this value (R1.4, design.md §5a).
   */
  programmeId: string | null;
  roles: Role[];
  /** Teams the user may edit/submit. */
  assignedTeamIds: string[];
  /** Whether the user can view the whole programme in Leadership View. */
  canViewAll: boolean;
}
