/**
 * Authorisation policy (Phase 8, design.md §5a permission matrix).
 *
 * Pure functions over an authenticated {@link CurrentUser} principal. Business
 * services call these to enforce permissions server-side (requirements.md R1.6
 * — default-deny; a hidden UI control is NOT authorisation). They do not depend
 * on how the principal was authenticated, so replacing local authentication
 * with OIDC never touches this policy.
 *
 * Every rule is default-deny: unless a capability is explicitly granted below it
 * is refused. All programme access additionally requires an `ACTIVE` account;
 * `PENDING`/`REJECTED`/`SUSPENDED` principals are refused everything except
 * `GET /me` (which does not call this policy).
 */
import type { CurrentUser, Role } from '../domain/identity.js';
import { ApiError } from '../http/errorEnvelope.js';

function has(user: CurrentUser, role: Role): boolean {
  return user.roles.includes(role);
}

function denied(message: string): never {
  throw new ApiError('PERMISSION_DENIED', message);
}

/**
 * Whether the principal is assigned to the requested programme. A null
 * `programmeId` (unassigned) never matches. This is the core of programme
 * scoping: a LEADERSHIP / ADMIN / AUDITOR role grants access ONLY to the
 * assigned programme, never to an arbitrary programme id (R1.4).
 */
function inProgramme(user: CurrentUser, programmeId: string): boolean {
  return user.programmeId !== null && user.programmeId === programmeId;
}

/** Require an ACTIVE account — the precondition for all programme access. */
export function assertActive(user: CurrentUser): void {
  if (user.status !== 'ACTIVE') {
    // A non-active principal reaching a service is a defence-in-depth backstop
    // behind the request hook; report it as an access denial, never a 500.
    denied('Your account is not active. Access is not permitted.');
  }
}

/**
 * Whether the user has a whole-programme (leadership) view of the given
 * programme — a LEADERSHIP/ADMIN/AUDITOR role scoped to that programme.
 */
export function canViewProgramme(user: CurrentUser, programmeId: string): boolean {
  return (
    user.status === 'ACTIVE' &&
    inProgramme(user, programmeId) &&
    (has(user, 'LEADERSHIP') || has(user, 'ADMIN') || has(user, 'AUDITOR'))
  );
}

/**
 * Any ACTIVE member of the requested programme (any assigned role). Used for
 * hierarchy and reporting-cycle reads.
 */
export function assertProgrammeMember(user: CurrentUser, programmeId: string): void {
  assertActive(user);
  if (inProgramme(user, programmeId)) return;
  denied('You are not assigned to this programme.');
}

/**
 * View a specific team's data: an assigned team within the user's programme, or
 * a whole-programme (leadership) view of that programme.
 */
export function assertCanViewTeam(
  user: CurrentUser,
  teamId: string,
  programmeId: string,
): void {
  assertActive(user);
  if (canViewProgramme(user, programmeId)) return;
  if (inProgramme(user, programmeId) && user.assignedTeamIds.includes(teamId)) return;
  denied('You do not have access to this team.');
}

/** Edit (save) a team draft: Contributor or Lead, scoped to an assigned team. */
export function assertCanEditTeam(
  user: CurrentUser,
  teamId: string,
  programmeId: string,
): void {
  assertActive(user);
  const isEditor = has(user, 'CONTRIBUTOR') || has(user, 'TEAM_LEAD');
  if (isEditor && inProgramme(user, programmeId) && user.assignedTeamIds.includes(teamId)) {
    return;
  }
  denied('You do not have permission to edit this team update.');
}

/** Submit or reopen a team update: Team Lead, scoped to an assigned team. */
export function assertCanSubmitTeam(
  user: CurrentUser,
  teamId: string,
  programmeId: string,
): void {
  assertActive(user);
  if (has(user, 'TEAM_LEAD') && inProgramme(user, programmeId) && user.assignedTeamIds.includes(teamId)) {
    return;
  }
  denied('Only an assigned Team Lead can submit or reopen this update.');
}

/** View leadership summary / filtered projection: Leadership, Admin or Auditor. */
export function assertCanViewProgramme(user: CurrentUser, programmeId: string): void {
  assertActive(user);
  if (canViewProgramme(user, programmeId)) return;
  denied('You do not have permission to view this programme.');
}

/** Record a leadership decision: Leadership or Admin, scoped to the programme. */
export function assertCanRecordDecision(user: CurrentUser, programmeId: string): void {
  assertActive(user);
  if (inProgramme(user, programmeId) && (has(user, 'LEADERSHIP') || has(user, 'ADMIN'))) {
    return;
  }
  denied('Only Programme Leadership can record a decision for this programme.');
}

/** Export the filtered snapshot: Leadership or Admin, scoped to the programme. */
export function assertCanExport(user: CurrentUser, programmeId: string): void {
  assertActive(user);
  if (inProgramme(user, programmeId) && (has(user, 'LEADERSHIP') || has(user, 'ADMIN'))) {
    return;
  }
  denied('You do not have permission to export this programme.');
}

/**
 * Perform an admin action: Admin only. Admin user-management is system-level in
 * the single-programme PoC, so it is not programme-scoped here (the admin's own
 * programme still bounds the assignments they may grant — validated separately).
 */
export function assertAdmin(user: CurrentUser): void {
  assertActive(user);
  if (has(user, 'ADMIN')) return;
  denied('Administrator access is required.');
}

/** Read the persisted audit history: Admin or Auditor only. */
export function assertCanReadAudit(user: CurrentUser): void {
  assertActive(user);
  if (has(user, 'ADMIN') || has(user, 'AUDITOR')) return;
  denied('Audit history is available to administrators and auditors only.');
}
