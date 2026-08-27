/**
 * Local-account identity domain shapes (Phase 8, design.md §5a).
 *
 * The PoC uses LOCAL account authentication — self-registration with email +
 * password (Argon2id), Admin approval and assignment, and opaque server-side
 * sessions. Enterprise OIDC is NOT implemented and remains a future decision
 * (task 0.2); these shapes live behind the `Authenticator` /
 * `AuthorizationPolicy` interfaces so OIDC can replace local authentication
 * later without rewriting business services.
 *
 * Persistence uses the `users`, `assignments` and `sessions` collections
 * (design.md §4a). There is deliberately NO separate access-request collection:
 * the Admin pending queue is `users` filtered by `status = PENDING`, and
 * `auditEvents` retains the decision history.
 */
import type { Role } from './identity.js';

/** The four account states an account can occupy (requirements.md R1a.1). */
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

/**
 * A stored local-account user (`users` collection).
 *
 * `passwordHash` is an Argon2id hash and is NEVER exposed through any API
 * response — the {@link PublicUser} projection is returned instead. Plaintext
 * passwords are never stored or logged (requirements.md R1.2).
 */
export interface UserAccount {
  id: string;
  /** Lowercased, unique. */
  email: string;
  displayName: string;
  /** Argon2id hash — never returned by any endpoint, never logged. */
  passwordHash: string;
  status: AccountStatus;
  /** Optional free-text team the registrant asked to join (R1.1). */
  requestedTeam?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The safe, API-facing projection of a user. Deliberately omits
 * `passwordHash` so it can never leak through a response (requirements.md R1.2).
 * Carries the resolved assignment (roles/teams) so the Admin Console can render
 * a user row without a second request.
 */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: AccountStatus;
  requestedTeam?: string;
  roles: Role[];
  teamIds: string[];
  programmeId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A user's programme/team/role assignment (`assignments` collection). One
 * document per user, keyed by `userId`. Absent until an Admin assigns access.
 */
export interface Assignment {
  /** Same value as {@link userId} (one assignment per user). */
  id: string;
  userId: string;
  /** Programme the user is assigned to (null until assigned). */
  programmeId: string | null;
  /** Teams the user may access (Contributor/Lead scope). */
  teamIds: string[];
  roles: Role[];
  updatedAt: string;
}

/**
 * An opaque server-side session (`sessions` collection). Keyed by the SHA-256
 * hash of the random token — the raw token is only ever sent in the cookie and
 * is never stored or logged (design.md §5a). Expired/unknown sessions are a
 * `401 SESSION_EXPIRED`.
 */
export interface SessionRecord {
  /** SHA-256 hash of the session token (the lookup key). */
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

/** Registration input (POST /auth/register). */
export interface RegisterInput {
  displayName: string;
  email: string;
  password: string;
  requestedTeam?: string;
}

/** Login input (POST /auth/login). */
export interface LoginInput {
  email: string;
  password: string;
}

/** Admin assignment change (approve / PUT assignments). */
export interface AssignmentInput {
  programmeId: string | null;
  teamIds: string[];
  roles: Role[];
}

/** Build the safe {@link PublicUser} projection from a user + optional assignment. */
export function toPublicUser(
  user: UserAccount,
  assignment: Assignment | null,
): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    ...(user.requestedTeam ? { requestedTeam: user.requestedTeam } : {}),
    roles: assignment?.roles ?? [],
    teamIds: assignment?.teamIds ?? [],
    programmeId: assignment?.programmeId ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
