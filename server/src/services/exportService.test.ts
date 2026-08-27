/**
 * Unit tests for the {@link ExportService} authorisation gate (task 7.10).
 *
 * These exercise the service in isolation with a fake {@link SummaryApi} and a
 * fake auth context — no HTTP, no database. They pin the security-critical
 * ordering behind the export endpoint (R16.4, design.md §13): the programme-
 * permission check runs BEFORE the leadership projection is ever consulted, so
 * an unauthorised caller can neither obtain data nor enumerate programmes by
 * observing PERMISSION_DENIED vs NOT_FOUND.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type { AuditEvent } from '../domain/documents.js';
import type { CurrentUser } from '../domain/identity.js';
import type { ReportingSummary } from '../domain/leadership.js';
import type { ApiError } from '../http/errorEnvelope.js';
import { ExportService, type ExportAuditPort } from './exportService.js';
import type { SummaryApi } from './summaryService.js';

/** A fake audit sink that records every appended event for assertions. */
function fakeAudit(): ExportAuditPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async appendAudit(event: AuditEvent): Promise<AuditEvent> {
      events.push(event);
      return event;
    },
  };
}

const BASE_USER: CurrentUser = {
  subject: 'user-md',
  email: 'maryna@example.com',
  displayName: 'Maryna D.',
  initials: 'MD',
  roleLabel: 'Test Lead',
  status: 'ACTIVE',
  programmeId: 'vsdd',
  roles: ['TEAM_LEAD', 'LEADERSHIP'],
  assignedTeamIds: ['mmm-a'],
  canViewAll: true,
};

function authFor(user: Partial<CurrentUser>): AuthContext {
  return { getCurrentUser: () => ({ ...BASE_USER, ...user }) };
}

const SUMMARY: ReportingSummary = {
  summary: {
    teamCount: 1,
    submittedCount: 1,
    draftOrMissingCount: 0,
    leadershipAskCount: 0,
    reportingPeriodLabel: 'Sprint 14 · Week 1',
  },
  snapshot: {
    programme: { id: 'vsdd', name: 'VSDD', active: true },
    sprint: { id: 'S14', programmeId: 'vsdd', label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT' },
    checkpoint: { id: 'C14-1', sprintId: 'S14', weekNumber: 1, opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT' },
    streams: [],
  },
  filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
};

const validRequest = {
  sprintId: 'S14',
  checkpointId: 'C14-1',
  filters: { streamId: 'ALL' as const, rag: 'ALL' as const, state: 'ALL' as const },
};

describe('ExportService authorisation', () => {
  it('produces a snapshot and an EXPORT_CREATED audit event for an authorised caller', async () => {
    const getReportingSummary = vi.fn(async () => SUMMARY);
    const audit = fakeAudit();
    const service = new ExportService({ getReportingSummary } as SummaryApi, authFor({}), audit);

    const snapshot = await service.createExport('vsdd', validRequest);

    expect(snapshot.programme).toBe('VSDD');
    expect(snapshot.recordCount).toBe(0);
    expect(getReportingSummary).toHaveBeenCalledWith('vsdd', {
      sprintId: 'S14',
      checkpointId: 'C14-1',
      streamId: 'ALL',
      rag: 'ALL',
      state: 'ALL',
    });

    // R15 — a successful export appends exactly one EXPORT_CREATED audit event
    // carrying the programme, actor, a non-sensitive filter summary and a
    // correlation id. It must NOT contain user-authored update content.
    expect(audit.events).toHaveLength(1);
    const event = audit.events[0]!;
    expect(event.action).toBe('EXPORT_CREATED');
    expect(event.entityType).toBe('EXPORT');
    expect(event.programmeId).toBe('vsdd');
    expect(event.aggregateId).toBe('vsdd');
    expect(event.actorSubject).toBe('user-md');
    expect(event.correlationId).toBeTruthy();
    expect(event.filterSummary).toContain('state=ALL');
    expect(event.reason).toBeUndefined();
  });

  it('refuses a caller lacking the LEADERSHIP role WITHOUT touching the projection or writing audit', async () => {
    const getReportingSummary = vi.fn(async () => SUMMARY);
    const audit = fakeAudit();
    const service = new ExportService(
      { getReportingSummary } as SummaryApi,
      authFor({ roles: ['CONTRIBUTOR'], canViewAll: false }),
      audit,
    );

    await expect(service.createExport('vsdd', validRequest)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    // The projection is never consulted — no data access, no enumeration — and
    // a denied export never writes a success audit event (R15).
    expect(getReportingSummary).not.toHaveBeenCalled();
    expect(audit.events).toHaveLength(0);
  });

  it('refuses a leadership caller assigned to a DIFFERENT programme (cross-programme)', async () => {
    const getReportingSummary = vi.fn(async () => SUMMARY);
    const audit = fakeAudit();
    const service = new ExportService(
      { getReportingSummary } as SummaryApi,
      authFor({ roles: ['LEADERSHIP'], programmeId: 'other-programme' }),
      audit,
    );

    // Leadership of another programme must not export "vsdd".
    await expect(service.createExport('vsdd', validRequest)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(getReportingSummary).not.toHaveBeenCalled();
    expect(audit.events).toHaveLength(0);
  });

  it('refuses an unauthorised caller identically regardless of programme id (no enumeration)', async () => {
    const getReportingSummary = vi.fn(async () => SUMMARY);
    const service = new ExportService(
      { getReportingSummary } as SummaryApi,
      authFor({ roles: ['CONTRIBUTOR'], canViewAll: false }),
      fakeAudit(),
    );

    const capture = async (programmeId: string): Promise<ApiError> => {
      try {
        await service.createExport(programmeId, validRequest);
        throw new Error('expected createExport to reject');
      } catch (error) {
        return error as ApiError;
      }
    };

    const real = await capture('vsdd');
    const fake = await capture('ghost');

    expect(real.code).toBe('PERMISSION_DENIED');
    expect(fake.code).toBe('PERMISSION_DENIED');
    expect(getReportingSummary).not.toHaveBeenCalled();
  });
});
