/**
 * Read-only audit-history query service (Phase 8 repair).
 *
 * Backs `GET /api/v1/audit`: the persisted MongoDB audit trail, newest-first,
 * paginated, filterable by userId / entityId / action. Read access is limited
 * to Admin and Auditor (design.md §5a permission matrix).
 *
 * The response is a SANITISED projection: it carries only stable ids, the
 * action, actor, entity/aggregate ids and timestamp. It deliberately OMITS the
 * `reason` and `filterSummary` fields so no user-authored content (e.g. a reopen
 * reason) — and, by construction, no password or session token — is ever
 * exposed through the audit endpoint (R1.10, design.md §13).
 */
import type { AuditAction, AuditEntityType, AuditEvent } from '../domain/documents.js';
import type { AuthContext } from '../auth/mockAuth.js';
import { assertCanReadAudit } from '../auth/authorization.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { AuditPageResult, AuditQuery } from '../repository/documentRepository.js';

/** The narrow repository slice this service needs. */
export interface AuditReadPort {
  queryAudit(query: AuditQuery): Promise<AuditPageResult>;
}

/** A safe, API-facing audit row (no free-text / secret fields). */
export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorSubject: string;
  entityType: AuditEntityType;
  entityId: string;
  aggregateId: string;
  timestamp: string;
  correlationId: string;
}

/** A page of audit entries plus paging metadata. */
export interface AuditPage {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Query params accepted by the endpoint (all optional). */
export interface AuditListQuery {
  userId?: string;
  entityId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

export interface AuditApi {
  list(query: AuditListQuery): Promise<AuditPage>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const VALID_ACTIONS: readonly AuditAction[] = [
  'DRAFT_SAVED',
  'SUBMITTED',
  'REOPENED',
  'DECISION_RECORDED',
  'EXPORT_CREATED',
  'USER_REGISTERED',
  'USER_APPROVED',
  'USER_REJECTED',
  'ASSIGNMENT_CHANGED',
  'USER_SUSPENDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'ADMIN_BOOTSTRAPPED',
];

export class AuditQueryService implements AuditApi {
  private readonly repository: AuditReadPort;
  private readonly auth: AuthContext;

  constructor(repository: AuditReadPort, auth: AuthContext) {
    this.repository = repository;
    this.auth = auth;
  }

  async list(query: AuditListQuery): Promise<AuditPage> {
    // Admin or Auditor only — enforced server-side (default-deny).
    assertCanReadAudit(this.auth.getCurrentUser());

    const limit = clamp(query.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const action = this.parseAction(query.action);

    const result = await this.repository.queryAudit({
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(action ? { action } : {}),
      limit,
      offset,
    });

    return {
      items: result.events.map(sanitise),
      total: result.total,
      limit,
      offset,
    };
  }

  private parseAction(raw: string | undefined): AuditAction | undefined {
    if (raw === undefined || raw === '') return undefined;
    const upper = raw.toUpperCase() as AuditAction;
    if (!VALID_ACTIONS.includes(upper)) {
      throw ApiError.validation('Unknown audit action filter.', [
        { path: 'action', message: `Must be one of: ${VALID_ACTIONS.join(', ')}.` },
      ]);
    }
    return upper;
  }
}

/** Project an internal audit event to the safe API row (drops free-text fields). */
function sanitise(event: AuditEvent): AuditEntry {
  return {
    id: event.id,
    action: event.action,
    actorSubject: event.actorSubject,
    entityType: event.entityType,
    entityId: event.entityId,
    aggregateId: event.aggregateId,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
