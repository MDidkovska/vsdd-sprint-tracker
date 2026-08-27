/**
 * Request authenticator (Phase 8, design.md §5a).
 *
 * The ONE seam an enterprise OIDC middleware would replace. It resolves the
 * request's session cookie into an authenticated {@link CurrentUser} principal
 * by looking up the session and RE-READING the user + assignment on every
 * request — so an approval or suspension takes effect on the next request
 * (R1.4/R1.5). An OIDC implementation would instead resolve a token/claims and
 * return the same principal shape; nothing downstream would change.
 */
import type { CurrentUser } from '../domain/identity.js';
import type {
  AssignmentStore,
  SessionStore,
  UserStore,
} from '../repository/identityRepository.js';
import { buildPrincipal } from './principal.js';
import { hashSessionToken } from './session.js';

export interface RequestAuthenticator {
  /**
   * Resolve a raw session token (from the cookie) into a principal, or null when
   * there is no valid, active-enough session. `REJECTED`/`SUSPENDED` accounts
   * lose access: their session is revoked and null is returned.
   */
  authenticate(token: string | undefined): Promise<CurrentUser | null>;
}

export class SessionAuthenticator implements RequestAuthenticator {
  private readonly sessions: SessionStore;
  private readonly users: UserStore;
  private readonly assignments: AssignmentStore;

  constructor(sessions: SessionStore, users: UserStore, assignments: AssignmentStore) {
    this.sessions = sessions;
    this.users = users;
    this.assignments = assignments;
  }

  async authenticate(token: string | undefined): Promise<CurrentUser | null> {
    if (!token) return null;

    const sessionId = hashSessionToken(token);
    const session = await this.sessions.getSession(sessionId);
    if (!session) return null; // missing / unknown / expired

    const user = await this.users.getUserById(session.userId);
    if (!user) {
      // Orphan session (user deleted): revoke and deny.
      await this.sessions.deleteSession(sessionId);
      return null;
    }

    // Revalidate status every request: a rejected or suspended account loses
    // access immediately — revoke the session and deny (R1.4).
    if (user.status === 'REJECTED' || user.status === 'SUSPENDED') {
      await this.sessions.deleteSessionsForUser(user.id);
      return null;
    }

    // PENDING and ACTIVE both resolve to a principal; the route-level ACTIVE
    // gate decides whether the principal may reach programme data (PENDING may
    // only reach GET /me so the UI can route to the pending screen).
    const assignment = await this.assignments.getAssignment(user.id);
    return buildPrincipal(user, assignment);
  }
}
