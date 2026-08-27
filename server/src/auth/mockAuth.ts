/**
 * Mocked authentication for the local PoC (design.md §4b).
 *
 * Authentication is intentionally NOT implemented for the PoC — production
 * enterprise OIDC integration is Phase 8. Endpoints assume a single mocked
 * authenticated subject, resolved here. This is the ONE seam a real OIDC
 * middleware will later replace: it returns the authenticated `CurrentUser`
 * (or throws `ApiError('PERMISSION_DENIED' | ...)` once real auth exists).
 */
import type { CurrentUser } from '../domain/identity.js';
import { MOCK_CURRENT_USER } from '../reference/referenceData.js';

/** Resolves the authenticated subject. Mocked for the PoC. */
export interface AuthContext {
  getCurrentUser(): CurrentUser;
}

/** The PoC auth context: always returns the single mocked subject. */
export const mockAuthContext: AuthContext = {
  getCurrentUser(): CurrentUser {
    return structuredClone(MOCK_CURRENT_USER);
  },
};
