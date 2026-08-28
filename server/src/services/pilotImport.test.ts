/**
 * Idempotent pilot-import tests (Phase 11, task 11.1).
 *
 * Prove the two guarantees the pilot import must uphold:
 *  1. DRY-RUN performs NO writes and correctly reports the planned changes.
 *  2. APPLY is idempotent: the first apply creates every record; a second apply
 *     is a pure no-op (no duplicate, no silent overwrite); and a partially
 *     pre-existing store (reference-seeded hierarchy, or a half-approved
 *     account) is reconciled to the same final state.
 *
 * The repository is a COMPOSED in-memory fake that delegates to the existing
 * in-memory hierarchy-admin and identity fakes, so the import runs against the
 * same seams the Mongo adapter implements — without MongoDB.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import type {
  Assignment,
  AccountStatus,
  SessionRecord,
  UserAccount,
} from '../domain/accounts.js';
import type { AuditEvent } from '../domain/documents.js';
import type { PasswordHasher } from '../auth/passwordHasher.js';
import type { AuditPageResult, AuditQuery } from '../repository/documentRepository.js';
import type { ReferenceData } from '../reference/referenceData.js';
import { InMemoryHierarchyAdminRepository } from '../repository/inMemoryHierarchyAdminRepository.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import type {
  ApproveUserAtomicInput,
  ChangeStatusAtomicInput,
  CreateAdminAtomicInput,
  CreateUserAtomicInput,
  UpdateAssignmentAtomicInput,
} from '../repository/identityRepository.js';
import {
  PILOT_ACCOUNTS,
  PILOT_CHECKPOINT_W1_ID,
  PILOT_CHECKPOINT_W2_ID,
  PILOT_SPRINT,
  PROGRAMME,
  STREAMS,
  TEAMS,
} from '../reference/pilotConfig.js';
import { PilotImportService, type PilotImportRepository } from './pilotImport.js';

/** A deterministic no-crypto hasher (the Argon2id choice is tested elsewhere). */
const fakeHasher: PasswordHasher = {
  async hash(password: string) {
    return `hashed:${password}`;
  },
  async verify(storedHash: string, password: string) {
    return storedHash === `hashed:${password}`;
  },
};

const PASSWORD = 'pilot-pass-123';

/**
 * Composed in-memory repository satisfying {@link PilotImportRepository}: the
 * hierarchy-admin reads/writes + programme seed delegate to the hierarchy fake;
 * the identity reads/writes delegate to the identity fake.
 */
class FakePilotRepo implements PilotImportRepository {
  readonly hierarchy = new InMemoryHierarchyAdminRepository();
  readonly identity = new InMemoryIdentityRepository();

  // --- reference reads (hierarchy) ----------------------------------------
  getProgramme(id: string): Promise<Programme | null> {
    return this.hierarchy.getProgramme(id);
  }
  getStream(id: string): Promise<Stream | null> {
    return this.hierarchy.getStream(id);
  }
  getTeam(id: string): Promise<Team | null> {
    return this.hierarchy.getTeam(id);
  }
  listTeams(programmeId: string): Promise<Team[]> {
    return this.hierarchy.listTeams(programmeId);
  }
  getSprint(id: string): Promise<Sprint | null> {
    return this.hierarchy.getSprint(id);
  }
  getCheckpoint(id: string): Promise<ReportingCheckpoint | null> {
    return this.hierarchy.getCheckpoint(id);
  }
  listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]> {
    return this.hierarchy.listCheckpoints(sprintId);
  }

  // --- reference / config writes (hierarchy) ------------------------------
  saveStreamWithAudit(stream: Stream, audit: AuditEvent): Promise<Stream> {
    return this.hierarchy.saveStreamWithAudit(stream, audit);
  }
  saveTeamWithAudit(team: Team, audit: AuditEvent): Promise<Team> {
    return this.hierarchy.saveTeamWithAudit(team, audit);
  }
  createSprint(
    sprint: Sprint,
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }> {
    return this.hierarchy.createSprint(sprint, checkpoints, audit);
  }
  saveCheckpointsWithAudit(
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ): Promise<ReportingCheckpoint[]> {
    return this.hierarchy.saveCheckpointsWithAudit(checkpoints, audit);
  }

  async seedReferenceData(data: ReferenceData): Promise<void> {
    for (const p of data.programmes) this.hierarchy.programmes.set(p.id, { ...p });
    for (const s of data.streams) this.hierarchy.streams.set(s.id, { ...s });
    for (const t of data.teams) this.hierarchy.teams.set(t.id, { ...t });
    for (const sp of data.sprints) this.hierarchy.sprints.set(sp.id, { ...sp });
    for (const cp of data.checkpoints) this.hierarchy.checkpoints.set(cp.id, { ...cp });
  }

  // --- identity ------------------------------------------------------------
  insertUser(user: UserAccount): Promise<void> {
    return this.identity.insertUser(user);
  }
  getUserById(id: string): Promise<UserAccount | null> {
    return this.identity.getUserById(id);
  }
  getUserByEmail(email: string): Promise<UserAccount | null> {
    return this.identity.getUserByEmail(email);
  }
  listUsers(status?: AccountStatus): Promise<UserAccount[]> {
    return this.identity.listUsers(status);
  }
  updateUserStatus(
    id: string,
    status: AccountStatus,
    updatedAt: string,
  ): Promise<UserAccount | null> {
    return this.identity.updateUserStatus(id, status, updatedAt);
  }
  getAssignment(userId: string): Promise<Assignment | null> {
    return this.identity.getAssignment(userId);
  }
  upsertAssignment(assignment: Assignment): Promise<void> {
    return this.identity.upsertAssignment(assignment);
  }
  createSession(session: SessionRecord): Promise<void> {
    return this.identity.createSession(session);
  }
  getSession(id: string): Promise<SessionRecord | null> {
    return this.identity.getSession(id);
  }
  deleteSession(id: string): Promise<void> {
    return this.identity.deleteSession(id);
  }
  deleteSessionsForUser(userId: string): Promise<void> {
    return this.identity.deleteSessionsForUser(userId);
  }
  appendAudit(event: AuditEvent): Promise<AuditEvent> {
    return this.identity.appendAudit(event);
  }
  queryAudit(query: AuditQuery): Promise<AuditPageResult> {
    return this.identity.queryAudit(query);
  }
  createUserWithAudit(input: CreateUserAtomicInput): Promise<void> {
    return this.identity.createUserWithAudit(input);
  }
  approveUserWithAssignment(input: ApproveUserAtomicInput): Promise<UserAccount> {
    return this.identity.approveUserWithAssignment(input);
  }
  updateAssignmentWithAudit(input: UpdateAssignmentAtomicInput): Promise<void> {
    return this.identity.updateAssignmentWithAudit(input);
  }
  changeUserStatusWithAudit(input: ChangeStatusAtomicInput): Promise<UserAccount> {
    return this.identity.changeUserStatusWithAudit(input);
  }
  createAdminAtomically(input: CreateAdminAtomicInput): Promise<void> {
    return this.identity.createAdminAtomically(input);
  }

  // --- test helpers --------------------------------------------------------
  totalAudits(): number {
    return this.hierarchy.auditEvents.length + this.identity.auditEvents.length;
  }
}

function newService(repo: FakePilotRepo): PilotImportService {
  return new PilotImportService({
    repository: repo,
    hasher: fakeHasher,
    defaultPassword: PASSWORD,
  });
}

const EXPECTED_RECORDS =
  1 /* programme */ +
  1 /* admin */ +
  STREAMS.length +
  TEAMS.length +
  1 /* sprint */ +
  2 /* checkpoints */ +
  PILOT_ACCOUNTS.length;

describe('PilotImportService — dry-run', () => {
  let repo: FakePilotRepo;

  beforeEach(() => {
    repo = new FakePilotRepo();
  });

  it('performs no writes and plans every record as a create on an empty store', async () => {
    const result = await newService(repo).run({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.summary.total).toBe(EXPECTED_RECORDS);
    expect(result.summary.create).toBe(EXPECTED_RECORDS);
    expect(result.summary.update).toBe(0);
    expect(result.summary.noop).toBe(0);

    // NO writes happened.
    expect(repo.hierarchy.programmes.size).toBe(0);
    expect(repo.hierarchy.streams.size).toBe(0);
    expect(repo.hierarchy.teams.size).toBe(0);
    expect(repo.hierarchy.sprints.size).toBe(0);
    expect(repo.hierarchy.checkpoints.size).toBe(0);
    expect((await repo.listUsers()).length).toBe(0);
    expect(repo.totalAudits()).toBe(0);
  });

  it('covers all five streams, all eight teams and both checkpoints in the plan', async () => {
    const result = await newService(repo).run({ dryRun: true });
    const ids = new Set(result.entries.map((e) => e.id));

    for (const stream of STREAMS) expect(ids.has(stream.id)).toBe(true);
    for (const team of TEAMS) expect(ids.has(team.id)).toBe(true);
    expect(ids.has(PILOT_SPRINT.id)).toBe(true);
    expect(ids.has(PILOT_CHECKPOINT_W1_ID)).toBe(true);
    expect(ids.has(PILOT_CHECKPOINT_W2_ID)).toBe(true);

    const w1 = result.entries.find((e) => e.id === PILOT_CHECKPOINT_W1_ID);
    expect(w1?.detail).toBe('CURRENT');
  });
});

describe('PilotImportService — apply', () => {
  let repo: FakePilotRepo;

  beforeEach(() => {
    repo = new FakePilotRepo();
  });

  it('first apply creates the full pilot configuration', async () => {
    const result = await newService(repo).run({ dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.summary.create).toBe(EXPECTED_RECORDS);
    expect(result.summary.update).toBe(0);
    expect(result.summary.noop).toBe(0);

    // Hierarchy: programme, five streams, eight teams.
    expect(repo.hierarchy.programmes.has(PROGRAMME.id)).toBe(true);
    expect(repo.hierarchy.streams.size).toBe(STREAMS.length);
    expect(repo.hierarchy.teams.size).toBe(TEAMS.length);

    // One two-week sprint with exactly two checkpoints; Week 1 CURRENT.
    expect(repo.hierarchy.sprints.size).toBe(1);
    const checkpoints = await repo.listCheckpoints(PILOT_SPRINT.id);
    expect(checkpoints.length).toBe(2);
    expect((await repo.getCheckpoint(PILOT_CHECKPOINT_W1_ID))?.status).toBe('CURRENT');
    expect((await repo.getCheckpoint(PILOT_CHECKPOINT_W2_ID))?.status).toBe('UPCOMING');

    // Accounts: admin + every pilot account, all ACTIVE with an assignment.
    const users = await repo.listUsers();
    expect(users.length).toBe(1 + PILOT_ACCOUNTS.length);
    expect(users.every((u) => u.status === 'ACTIVE')).toBe(true);

    // 8/8 teams have an assigned Team Lead (pilot success criteria).
    for (const team of TEAMS) {
      const lead = await repo.getAssignment(`pilot-lead-${team.id}`);
      expect(lead?.roles).toContain('TEAM_LEAD');
      expect(lead?.teamIds).toContain(team.id);
      expect(lead?.programmeId).toBe(PROGRAMME.id);
    }

    // No password (or its hash prefix) leaks into any audit event.
    const auditJson = JSON.stringify([
      ...repo.hierarchy.auditEvents,
      ...repo.identity.auditEvents,
    ]);
    expect(auditJson).not.toContain(PASSWORD);
    expect(auditJson).not.toContain('hashed:');
  });

  it('second apply is a pure no-op: no duplicates, no silent overwrite', async () => {
    const service = newService(repo);
    await service.run({ dryRun: false });

    const usersAfterFirst = (await repo.listUsers()).length;
    const auditsAfterFirst = repo.totalAudits();
    const streamsAfterFirst = repo.hierarchy.streams.size;
    const teamsAfterFirst = repo.hierarchy.teams.size;

    const second = await service.run({ dryRun: false });

    // Every record is unchanged.
    expect(second.summary.create).toBe(0);
    expect(second.summary.update).toBe(0);
    expect(second.summary.noop).toBe(EXPECTED_RECORDS);

    // Nothing duplicated and no extra audit event written.
    expect((await repo.listUsers()).length).toBe(usersAfterFirst);
    expect(repo.hierarchy.streams.size).toBe(streamsAfterFirst);
    expect(repo.hierarchy.teams.size).toBe(teamsAfterFirst);
    expect(repo.hierarchy.sprints.size).toBe(1);
    expect(repo.hierarchy.checkpoints.size).toBe(2);
    expect(repo.totalAudits()).toBe(auditsAfterFirst);

    // Week 1 is still the single CURRENT checkpoint.
    const current = (await repo.listCheckpoints(PILOT_SPRINT.id)).filter(
      (c) => c.status === 'CURRENT',
    );
    expect(current.map((c) => c.id)).toEqual([PILOT_CHECKPOINT_W1_ID]);
  });

  it('a dry-run after an apply reports every record as unchanged', async () => {
    const service = newService(repo);
    await service.run({ dryRun: false });
    const plan = await service.run({ dryRun: true });
    expect(plan.summary.noop).toBe(EXPECTED_RECORDS);
    expect(plan.summary.create).toBe(0);
    expect(plan.summary.update).toBe(0);
  });
});

describe('PilotImportService — reconciles partial pre-existing state', () => {
  it('treats an already reference-seeded hierarchy as no-op and only creates the rest', async () => {
    const repo = new FakePilotRepo();
    // Simulate the store already seeded on startup with the reference hierarchy.
    await repo.seedReferenceData({
      programmes: [{ ...PROGRAMME, active: true }],
      streams: STREAMS.map((s) => ({ ...s })),
      teams: TEAMS.map((t) => ({ ...t })),
      sprints: [],
      checkpoints: [],
    });

    const plan = await newService(repo).run({ dryRun: true });
    const byId = new Map(plan.entries.map((e) => [e.id, e]));

    expect(byId.get(PROGRAMME.id)?.action).toBe('noop');
    for (const stream of STREAMS) expect(byId.get(stream.id)?.action).toBe('noop');
    for (const team of TEAMS) expect(byId.get(team.id)?.action).toBe('noop');
    // The sprint, checkpoints and accounts still need creating.
    expect(byId.get(PILOT_SPRINT.id)?.action).toBe('create');
    expect(byId.get(PILOT_ACCOUNTS[0].id)?.action).toBe('create');

    // Applying reconciles to the full configuration without duplicating streams.
    const applied = await newService(repo).run({ dryRun: false });
    expect(applied.summary.create).toBeGreaterThan(0);
    expect(repo.hierarchy.streams.size).toBe(STREAMS.length);
    expect(repo.hierarchy.teams.size).toBe(TEAMS.length);
    expect(repo.hierarchy.sprints.size).toBe(1);
    expect((await repo.listUsers()).length).toBe(1 + PILOT_ACCOUNTS.length);
  });

  it('approves and assigns an account left PENDING by an interrupted earlier run', async () => {
    const repo = new FakePilotRepo();
    const service = newService(repo);
    // First seed the hierarchy so assignment validation has real teams.
    await service.run({ dryRun: false });

    // Simulate a NEW pilot account that only got as far as PENDING.
    const timestamp = new Date().toISOString();
    await repo.createUserWithAudit({
      user: {
        id: 'pilot-latecomer',
        email: 'latecomer@vsdd.example',
        displayName: 'Late Comer',
        passwordHash: 'hashed:whatever',
        status: 'PENDING',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      audit: {
        id: 'a-late',
        programmeId: 'system',
        aggregateId: 'pilot-latecomer',
        entityType: 'USER',
        entityId: 'pilot-latecomer',
        action: 'USER_REGISTERED',
        actorSubject: 'pilot-latecomer',
        timestamp,
        correlationId: 'c-late',
      },
    });

    // The import's account set does not include this ad-hoc account, so it is
    // left as-is; but a genuine PENDING pilot account is reconciled. Prove the
    // PENDING branch by re-pointing an existing pilot account back to PENDING.
    const lead = await repo.getUserByEmail(PILOT_ACCOUNTS[0].email);
    await repo.updateUserStatus(lead!.id, 'PENDING', new Date().toISOString());

    const plan = await service.run({ dryRun: true });
    const entry = plan.entries.find((e) => e.id === lead!.id);
    expect(entry?.action).toBe('update');
    expect(entry?.detail).toContain('approve+assign');

    await service.run({ dryRun: false });
    const reconciled = await repo.getUserById(lead!.id);
    expect(reconciled?.status).toBe('ACTIVE');
  });
});
