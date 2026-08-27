/**
 * Request-scoped authentication context (Phase 8, design.md §5a).
 *
 * Business services keep depending on the existing `AuthContext.getCurrentUser()`
 * seam. In the running server that seam is backed by an `AsyncLocalStorage`
 * populated per request by the authentication hook, so a service never learns
 * whether the principal came from a local session or (later) an OIDC token.
 *
 * This is the runtime counterpart of the mocked `AuthContext`: the mock returns
 * a fixed subject for unit/endpoint tests, while this reads the principal the
 * hook resolved for the current request.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthContext } from './mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import { ApiError } from '../http/errorEnvelope.js';

const principalStorage = new AsyncLocalStorage<CurrentUser>();

/**
 * Run `fn` with the authenticated principal bound to the async context. The
 * authentication hook wraps the continuation of the request lifecycle in this,
 * so every service call downstream in the same request sees the principal.
 * Using `run` (not `enterWith`) is what reliably propagates the context from the
 * onRequest hook into the route handler under Fastify.
 */
export function runWithPrincipal<T>(principal: CurrentUser, fn: () => T): T {
  return principalStorage.run(principal, fn);
}

/** Read the current request's principal, or undefined when none is bound. */
export function getRequestPrincipal(): CurrentUser | undefined {
  return principalStorage.getStore();
}

/**
 * The request-scoped auth context wired into the business services in the real
 * server. Throws UNAUTHENTICATED if a service asks for the principal on a
 * request that was never authenticated (a defence-in-depth backstop behind the
 * route hook, which already rejects such requests).
 */
export const requestAuthContext: AuthContext = {
  getCurrentUser(): CurrentUser {
    const principal = principalStorage.getStore();
    if (!principal) {
      throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    }
    return principal;
  },
};
