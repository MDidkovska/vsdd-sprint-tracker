/**
 * Principal builder (Phase 8, design.md §5a).
 *
 * Turns a stored user + assignment into the authenticated {@link CurrentUser}
 * principal that flows through the request context and `GET /me`. This is the
 * only place account/assignment records become a principal, so the shape stays
 * consistent whether it is produced at login or re-derived by the request
 * authenticator on a later request (status/assignment are always re-read, so an
 * approval or suspension takes effect on the next request — R1.4/R1.5).
 */
import type { Assignment, UserAccount } from '../domain/accounts.js';
import type { CurrentUser, Role } from '../domain/identity.js';

/** Derive up-to-two-letter initials from a display name. */
export function deriveInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** A human-friendly role label, highest-privilege first. */
export function deriveRoleLabel(roles: Role[], status: string): string {
  if (status !== 'ACTIVE') return 'Pending approval';
  if (roles.includes('ADMIN')) return 'Programme Admin';
  if (roles.includes('LEADERSHIP')) return 'Programme Leadership';
  if (roles.includes('AUDITOR')) return 'Auditor';
  if (roles.includes('TEAM_LEAD')) return 'Team Lead';
  if (roles.includes('CONTRIBUTOR')) return 'Team Contributor';
  return 'No role assigned';
}

/** Whether a role set grants whole-programme leadership visibility. */
export function canViewAllFor(roles: Role[]): boolean {
  return (
    roles.includes('LEADERSHIP') || roles.includes('ADMIN') || roles.includes('AUDITOR')
  );
}

/** Build the authenticated principal from a user account and its assignment. */
export function buildPrincipal(
  user: UserAccount,
  assignment: Assignment | null,
): CurrentUser {
  const roles = assignment?.roles ?? [];
  const teamIds = assignment?.teamIds ?? [];
  return {
    subject: user.id,
    email: user.email,
    displayName: user.displayName,
    initials: deriveInitials(user.displayName),
    roleLabel: deriveRoleLabel(roles, user.status),
    status: user.status,
    programmeId: assignment?.programmeId ?? null,
    roles,
    assignedTeamIds: teamIds,
    canViewAll: canViewAllFor(roles),
  };
}
