/**
 * Frontend auth client (Phase 8, design.md §5a).
 *
 * A small, replaceable seam mirroring the backend local-account API. The UI
 * depends only on the {@link AuthClient} contract:
 *  - {@link createHttpAuthClient} talks to the real backend with a session
 *    cookie (`credentials: 'include'`); the opaque token is never read by JS.
 *  - {@link createMockAuthClient} is an in-memory implementation so the Phase A
 *    demo and the component tests run without a backend.
 *
 * Swapping the mock for the HTTP client is a one-line change at the composition
 * root — the screens never change.
 */
import type { AccountStatus, CurrentUser, Role } from '../api/repository';
import { csrfHeaders } from '../lib/csrf';

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

export interface RegisterInput {
  displayName: string;
  email: string;
  password: string;
  requestedTeam?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AssignmentInput {
  programmeId: string | null;
  teamIds: string[];
  roles: Role[];
}

/** Persisted audit actions surfaced to the Admin Console (mirrors the backend). */
export type AuditAction =
  | 'DRAFT_SAVED'
  | 'SUBMITTED'
  | 'REOPENED'
  | 'DECISION_RECORDED'
  | 'EXPORT_CREATED'
  | 'USER_REGISTERED'
  | 'USER_APPROVED'
  | 'USER_REJECTED'
  | 'ASSIGNMENT_CHANGED'
  | 'USER_SUSPENDED'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'ADMIN_BOOTSTRAPPED';

/** A safe, API-facing audit row (no free-text / secret fields). */
export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorSubject: string;
  entityType: string;
  entityId: string;
  aggregateId: string;
  timestamp: string;
  correlationId: string;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditListQuery {
  userId?: string;
  entityId?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

/** Stable auth error codes surfaced to the UI (mirrors the backend envelope). */
export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'AUTH_FAILED'
  | 'ACCOUNT_INACTIVE'
  | 'RATE_LIMITED'
  | 'EMAIL_TAKEN'
  | 'VALIDATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'SAVE_FAILED';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface AuthClient {
  /** Resolve the current principal, or null when unauthenticated (401). */
  getMe(): Promise<CurrentUser | null>;
  register(input: RegisterInput): Promise<PublicUser>;
  login(input: LoginInput): Promise<CurrentUser>;
  logout(): Promise<void>;
  // Admin surface
  listUsers(status?: AccountStatus): Promise<PublicUser[]>;
  approve(userId: string, assignment: AssignmentInput): Promise<PublicUser>;
  reject(userId: string): Promise<PublicUser>;
  updateAssignments(userId: string, assignment: AssignmentInput): Promise<PublicUser>;
  suspend(userId: string): Promise<PublicUser>;
  /** Persisted audit history (Admin/Auditor), newest-first, paginated. */
  listAudit(query?: AuditListQuery): Promise<AuditPage>;
}

// --- HTTP implementation ---------------------------------------------------

interface ErrorEnvelope {
  error?: { code?: AuthErrorCode; message?: string };
}

/** Resolve the API base URL from the Vite env, defaulting to the `/api` proxy. */
export function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_API_BASE_URL;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : '/api/v1';
}

export function createHttpAuthClient(baseUrl = resolveApiBaseUrl()): AuthClient {
  async function request<T>(
    path: string,
    init: RequestInit & { allow401?: boolean } = {},
  ): Promise<T> {
    const { allow401, ...rest } = init;
    const res = await fetch(`${baseUrl}${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...csrfHeaders(rest.method),
        ...rest.headers,
      },
    });
    if (res.status === 401 && allow401) {
      return null as T;
    }
    if (!res.ok) {
      let code: AuthErrorCode = 'SAVE_FAILED';
      let message = 'Something went wrong. Please try again.';
      try {
        const body = (await res.json()) as ErrorEnvelope;
        if (body.error?.code) code = body.error.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON error; keep the defaults.
      }
      throw new AuthError(code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    getMe: () => request<CurrentUser | null>('/me', { method: 'GET', allow401: true }),
    register: (input) =>
      request<PublicUser>('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
    login: (input) =>
      request<CurrentUser>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    listUsers: (status) =>
      request<PublicUser[]>(`/admin/users${status ? `?status=${status}` : ''}`, { method: 'GET' }),
    approve: (userId, assignment) =>
      request<PublicUser>(`/admin/users/${encodeURIComponent(userId)}/approve`, {
        method: 'POST',
        body: JSON.stringify(assignment),
      }),
    reject: (userId) =>
      request<PublicUser>(`/admin/users/${encodeURIComponent(userId)}/reject`, { method: 'POST' }),
    updateAssignments: (userId, assignment) =>
      request<PublicUser>(`/admin/users/${encodeURIComponent(userId)}/assignments`, {
        method: 'PUT',
        body: JSON.stringify(assignment),
      }),
    suspend: (userId) =>
      request<PublicUser>(`/admin/users/${encodeURIComponent(userId)}/suspend`, { method: 'POST' }),
    listAudit: (query = {}) => {
      const params = new URLSearchParams();
      if (query.userId) params.set('userId', query.userId);
      if (query.entityId) params.set('entityId', query.entityId);
      if (query.action) params.set('action', query.action);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));
      const qs = params.toString();
      return request<AuditPage>(`/audit${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },
  };
}
