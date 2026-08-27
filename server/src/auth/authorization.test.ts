/**
 * Authorisation policy tests (Phase 8 repair) — the PROGRAMME-SCOPED role
 * permission matrix. A LEADERSHIP/ADMIN/AUDITOR role grants access only to the
 * assigned programme, and the AUDITOR policy is strictly read-only.
 */
import { describe, expect, it } from 'vitest';
import type { CurrentUser, Role } from '../domain/identity.js';
import {
  assertAdmin,
  assertCanEditTeam,
  assertCanExport,
  assertCanReadAudit,
  assertCanRecordDecision,
  assertCanSubmitTeam,
  assertCanViewProgramme,
  assertCanViewTeam,
  assertProgrammeMember,
} from './authorization.js';

const PROG = 'vsdd';
const OTHER = 'other-programme';

function user(
  roles: Role[],
  overrides: Partial<CurrentUser> = {},
): CurrentUser {
  return {
    subject: 'u1',
    email: 'u1@example.com',
    displayName: 'U One',
    initials: 'UO',
    roleLabel: 'x',
    status: 'ACTIVE',
    programmeId: PROG,
    roles,
    assignedTeamIds: [],
    canViewAll: roles.some((r) => r === 'LEADERSHIP' || r === 'ADMIN' || r === 'AUDITOR'),
    ...overrides,
  };
}

const AUDITOR = user(['AUDITOR']);

describe('Auditor is strictly read-only (within its programme)', () => {
  it('may read the programme, a team and audit history', () => {
    expect(() => assertProgrammeMember(AUDITOR, PROG)).not.toThrow();
    expect(() => assertCanViewProgramme(AUDITOR, PROG)).not.toThrow();
    expect(() => assertCanViewTeam(AUDITOR, 'mmm-a', PROG)).not.toThrow();
    expect(() => assertCanReadAudit(AUDITOR)).not.toThrow();
  });

  it('may NOT edit / submit / decide / export / admin', () => {
    expect(() => assertCanEditTeam(AUDITOR, 'mmm-a', PROG)).toThrow();
    expect(() => assertCanSubmitTeam(AUDITOR, 'mmm-a', PROG)).toThrow();
    expect(() => assertCanRecordDecision(AUDITOR, PROG)).toThrow();
    expect(() => assertCanExport(AUDITOR, PROG)).toThrow();
    expect(() => assertAdmin(AUDITOR)).toThrow();
  });
});

describe('programme scoping — role does not apply to another programme', () => {
  it('denies Leadership/Admin/Auditor reads outside their programme', () => {
    expect(() => assertCanViewProgramme(user(['LEADERSHIP']), OTHER)).toThrow();
    expect(() => assertCanViewProgramme(user(['ADMIN']), OTHER)).toThrow();
    expect(() => assertCanViewProgramme(user(['AUDITOR']), OTHER)).toThrow();
    expect(() => assertProgrammeMember(user(['CONTRIBUTOR']), OTHER)).toThrow();
  });

  it('denies decisions/export outside their programme', () => {
    expect(() => assertCanRecordDecision(user(['LEADERSHIP']), OTHER)).toThrow();
    expect(() => assertCanExport(user(['ADMIN']), OTHER)).toThrow();
  });

  it('denies team writes outside their programme even for an assigned team id', () => {
    const lead = user(['TEAM_LEAD'], { assignedTeamIds: ['mmm-a'] });
    expect(() => assertCanSubmitTeam(lead, 'mmm-a', OTHER)).toThrow();
    expect(() => assertCanEditTeam(lead, 'mmm-a', OTHER)).toThrow();
  });

  it('denies an unassigned principal (null programmeId) everything programme-scoped', () => {
    const unassigned = user([], { programmeId: null });
    expect(() => assertProgrammeMember(unassigned, PROG)).toThrow();
    expect(() => assertCanViewProgramme(unassigned, PROG)).toThrow();
  });
});

describe('positive programme-scoped grants', () => {
  it('allows Leadership/Admin to view + decide + export within their programme', () => {
    expect(() => assertCanViewProgramme(user(['LEADERSHIP']), PROG)).not.toThrow();
    expect(() => assertCanRecordDecision(user(['LEADERSHIP']), PROG)).not.toThrow();
    expect(() => assertCanRecordDecision(user(['ADMIN']), PROG)).not.toThrow();
    expect(() => assertCanExport(user(['ADMIN']), PROG)).not.toThrow();
  });

  it('allows an assigned Contributor to edit and a Team Lead to submit their team', () => {
    const contrib = user(['CONTRIBUTOR'], { assignedTeamIds: ['mmm-a'] });
    const lead = user(['TEAM_LEAD'], { assignedTeamIds: ['mmm-a'] });
    expect(() => assertCanEditTeam(contrib, 'mmm-a', PROG)).not.toThrow();
    expect(() => assertCanSubmitTeam(lead, 'mmm-a', PROG)).not.toThrow();
    // ...but not another team.
    expect(() => assertCanEditTeam(contrib, 'mmm-b', PROG)).toThrow();
  });
});

describe('audit-read policy', () => {
  it('allows ADMIN and AUDITOR only', () => {
    expect(() => assertCanReadAudit(user(['ADMIN']))).not.toThrow();
    expect(() => assertCanReadAudit(user(['AUDITOR']))).not.toThrow();
    expect(() => assertCanReadAudit(user(['LEADERSHIP']))).toThrow();
    expect(() => assertCanReadAudit(user(['CONTRIBUTOR']))).toThrow();
  });
});

describe('non-active accounts are denied everything', () => {
  const pending = user(['AUDITOR'], { status: 'PENDING' });
  it('denies read + audit for a non-active auditor', () => {
    expect(() => assertCanViewProgramme(pending, PROG)).toThrow();
    expect(() => assertCanReadAudit(pending)).toThrow();
  });
});
