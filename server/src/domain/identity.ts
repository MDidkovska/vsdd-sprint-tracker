/**
 * Authenticated-identity shapes for the PoC backend.
 *
 * These MIRROR the frontend `CurrentUser` / `Role` contract
 * (`src/api/repository.ts`) and the OpenAPI `CurrentUser` / `Role` schemas
 * (task 7.1). Authentication is intentionally MOCKED for the local PoC
 * (design.md §4b); production enterprise OIDC integration is Phase 8. The
 * `/me` endpoint returns this shape from a mocked authenticated subject.
 */

export type Role =
  | 'CONTRIBUTOR'
  | 'TEAM_LEAD'
  | 'LEADERSHIP'
  | 'ADMIN'
  | 'AUDITOR';

export interface CurrentUser {
  /** Stable OIDC subject id (mocked for the PoC). */
  subject: string;
  displayName: string;
  initials: string;
  roleLabel: string;
  roles: Role[];
  /** Teams the user may edit/submit. */
  assignedTeamIds: string[];
  /** Whether the user can view the whole programme in Leadership View. */
  canViewAll: boolean;
}
