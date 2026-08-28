/**
 * Idempotent controlled-pilot import (Phase 11, task 11.1).
 *
 * Configures the store for the controlled PoC pilot across all eight VSDD teams
 * WITHOUT a code deployment: the programme, its five streams and eight teams,
 * one two-week sprint (Week 1 + Week 2 checkpoints, Week 1 CURRENT) and the
 * pilot accounts / roles / assignments (R1a, R2, R17, pilot success criteria).
 *
 * It is a thin ORCHESTRATOR over the existing seams — it invents no new write
 * paths:
 *  - the Phase 9.5 {@link HierarchyAdminService} for streams, teams, the sprint
 *    (which generates exactly two weekly checkpoints, R2.1) and set-current
 *    (exactly one CURRENT, R2.2);
 *  - the Phase 8 {@link AdminService} for approve + programme/team/role
 *    assignment, so assignments are validated server-side against real
 *    reference data (R1a.4a);
 *  - the idempotent first-admin {@link bootstrapAdmin} for the pilot Admin.
 *
 * Two guarantees define the import (task 11.1):
 *  1. DRY-RUN — {@link PilotImportService.run} with `dryRun: true` performs NO
 *     writes. It only READS current state and returns the exact plan (per record:
 *     create / update / no-op) that an apply WOULD perform.
 *  2. IDEMPOTENT APPLY — every record is matched by its STABLE id (or an
 *     account's email). An apply creates only what is absent, reconciles only
 *     what differs, and leaves matching records untouched. Re-running never
 *     duplicates a record and never silently overwrites one, and a partially
 *     pre-existing store (e.g. one already reference-seeded on startup, or a
 *     half-finished earlier run) is reconciled to the same final state.
 */
import { randomUUID } from 'node:crypto';
import type { UserAccount } from '../domain/accounts.js';
import type { AuditEvent } from '../domain/documents.js';
import type { CurrentUser } from '../domain/identity.js';
import type { AuthContext } from '../auth/mockAuth.js';
import type { PasswordHasher } from '../auth/passwordHasher.js';
import type { DocumentRepository } from '../repository/documentRepository.js';
import type { IdentityRepository } from '../repository/identityRepository.js';
import {
  AdminService,
  type AdminReferenceReadPort,
} from './adminService.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';
import {
  HierarchyAdminService,
  type HierarchyAdminRepository,
} from './hierarchyAdminService.js';
import {
  PILOT_ACCOUNTS,
  PILOT_ADMIN,
  PILOT_CHECKPOINT_W1_ID,
  PILOT_CHECKPOINT_W2_ID,
  PILOT_SPRINT,
  PROGRAMME,
  STREAMS,
  TEAMS,
  type PilotAccountConfig,
} from '../reference/pilotConfig.js';

const SYSTEM_PROGRAMME = 'system';

/**
 * The narrow persistence port the import needs: the hierarchy-admin reads/atomic
 * writes, the identity reads/atomic writes, and the idempotent programme seed.
 * It is a structural subset of {@link DocumentRepository} + {@link IdentityRepository},
 * so the production Mongo adapter satisfies it directly and a composed in-memory
 * fake satisfies it in tests. The {@link AdminReferenceReadPort} needs
 * (getProgramme + listTeams) are already part of {@link HierarchyAdminRepository}.
 */
export type PilotImportRepository = HierarchyAdminRepository &
  IdentityRepository &
  Pick<DocumentRepository, 'seedReferenceData'>;

export type PilotAction = 'create' | 'update' | 'noop';

export type PilotEntryKind =
  | 'programme'
  | 'stream'
  | 'team'
  | 'sprint'
  | 'checkpoint'
  | 'account';

/** One planned/applied change for a single record. */
export interface PilotPlanEntry {
  kind: PilotEntryKind;
  /** Stable id of the record (account entries use the account id). */
  id: string;
  /** Human-readable label (name / email). */
  label: string;
  action: PilotAction;
  /** Optional extra context (role set, checkpoint status, reason). */
  detail?: string;
}

export interface PilotImportSummary {
  create: number;
  update: number;
  noop: number;
  total: number;
}

export interface PilotImportResult {
  /** True when the run performed no writes (planning only). */
  dryRun: boolean;
  entries: PilotPlanEntry[];
  summary: PilotImportSummary;
}

export interface PilotImportDeps {
  repository: PilotImportRepository;
  hasher: PasswordHasher;
  /**
   * Password applied to freshly-created pilot accounts. Never sourced from code
   * — the CLI reads it from the environment. Only used when a NEW account is
   * created (apply mode); re-runs never touch credentials.
   */
  defaultPassword: string;
  now?: () => number;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sorted(a);
  const sb = sorted(b);
  return sa.every((value, index) => value === sb[index]);
}

export class PilotImportService {
  private readonly repo: PilotImportRepository;
  private readonly hasher: PasswordHasher;
  private readonly defaultPassword: string;
  private readonly now: () => number;

  constructor(deps: PilotImportDeps) {
    this.repo = deps.repository;
    this.hasher = deps.hasher;
    this.defaultPassword = deps.defaultPassword;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Plan (and, unless `dryRun`, apply) the full pilot configuration. Records are
   * processed in dependency order (programme → admin → streams → teams → sprint
   * / checkpoints → accounts) so that in apply mode each later write sees the
   * records it depends on, and the assignment validation runs against real,
   * already-created teams.
   */
  async run(options: { dryRun: boolean }): Promise<PilotImportResult> {
    const dryRun = options.dryRun;
    const entries: PilotPlanEntry[] = [];

    await this.reconcileProgramme(entries, dryRun);
    const adminId = await this.reconcileAdmin(entries, dryRun);

    // The admin principal that authorises every subsequent write (apply mode).
    const adminAuth = this.buildAdminAuth(adminId);
    const hierarchy = new HierarchyAdminService({
      repository: this.repo,
      auth: adminAuth,
      now: this.now,
    });
    const admin = new AdminService({
      identity: this.repo,
      reference: this.repo as AdminReferenceReadPort,
      auth: adminAuth,
      now: this.now,
    });

    await this.reconcileStreams(entries, dryRun, hierarchy);
    await this.reconcileTeams(entries, dryRun, hierarchy);
    await this.reconcileSprint(entries, dryRun, hierarchy);
    await this.reconcileAccounts(entries, dryRun, admin);

    return { dryRun, entries, summary: this.summarise(entries) };
  }

  // --- programme ------------------------------------------------------------

  private async reconcileProgramme(entries: PilotPlanEntry[], dryRun: boolean): Promise<void> {
    const existing = await this.repo.getProgramme(PROGRAMME.id);
    if (!existing) {
      entries.push({ kind: 'programme', id: PROGRAMME.id, label: PROGRAMME.name, action: 'create' });
      if (!dryRun) await this.seedProgramme();
      return;
    }
    if (existing.name !== PROGRAMME.name || !existing.active) {
      entries.push({ kind: 'programme', id: PROGRAMME.id, label: PROGRAMME.name, action: 'update' });
      if (!dryRun) await this.seedProgramme();
      return;
    }
    entries.push({ kind: 'programme', id: PROGRAMME.id, label: PROGRAMME.name, action: 'noop' });
  }

  /** Upsert only the programme document (streams/teams handled separately). */
  private async seedProgramme(): Promise<void> {
    await this.repo.seedReferenceData({
      programmes: [{ ...PROGRAMME, active: true }],
      streams: [],
      teams: [],
      sprints: [],
      checkpoints: [],
    });
  }

  // --- admin account (bootstrap) -------------------------------------------

  /** Ensure the pilot Admin exists (idempotent). Returns its account id. */
  private async reconcileAdmin(entries: PilotPlanEntry[], dryRun: boolean): Promise<string> {
    const existing = await this.repo.getUserByEmail(PILOT_ADMIN.email);
    if (existing) {
      entries.push({
        kind: 'account',
        id: existing.id,
        label: PILOT_ADMIN.email,
        action: 'noop',
        detail: 'ADMIN',
      });
      return existing.id;
    }
    entries.push({
      kind: 'account',
      id: PILOT_ADMIN.id,
      label: PILOT_ADMIN.email,
      action: 'create',
      detail: 'ADMIN',
    });
    if (dryRun) return PILOT_ADMIN.id;

    const result = await bootstrapAdmin(
      {
        identity: this.repo,
        hasher: this.hasher,
        now: this.now,
        idFactory: () => PILOT_ADMIN.id,
      },
      {
        email: PILOT_ADMIN.email,
        displayName: PILOT_ADMIN.displayName,
        password: this.defaultPassword,
        programmeId: PROGRAMME.id,
      },
    );
    return result.userId;
  }

  private buildAdminAuth(adminId: string): AuthContext {
    const principal: CurrentUser = {
      subject: adminId,
      email: PILOT_ADMIN.email,
      displayName: PILOT_ADMIN.displayName,
      initials: 'PA',
      roleLabel: 'Pilot Admin',
      status: 'ACTIVE',
      programmeId: PROGRAMME.id,
      roles: ['ADMIN'],
      assignedTeamIds: [],
      canViewAll: true,
    };
    return { getCurrentUser: () => structuredClone(principal) };
  }

  // --- streams --------------------------------------------------------------

  private async reconcileStreams(
    entries: PilotPlanEntry[],
    dryRun: boolean,
    hierarchy: HierarchyAdminService,
  ): Promise<void> {
    for (const stream of STREAMS) {
      const existing = await this.repo.getStream(stream.id);
      if (!existing) {
        entries.push({ kind: 'stream', id: stream.id, label: stream.name, action: 'create' });
        if (!dryRun) {
          await hierarchy.createStream({
            id: stream.id,
            programmeId: PROGRAMME.id,
            name: stream.name,
            sortOrder: stream.sortOrder,
          });
        }
        continue;
      }
      const differs =
        existing.name !== stream.name ||
        existing.sortOrder !== stream.sortOrder ||
        !existing.active;
      if (differs) {
        entries.push({ kind: 'stream', id: stream.id, label: stream.name, action: 'update' });
        if (!dryRun) {
          await hierarchy.updateStream({
            id: stream.id,
            name: stream.name,
            sortOrder: stream.sortOrder,
            active: true,
          });
        }
        continue;
      }
      entries.push({ kind: 'stream', id: stream.id, label: stream.name, action: 'noop' });
    }
  }

  // --- teams ----------------------------------------------------------------

  private async reconcileTeams(
    entries: PilotPlanEntry[],
    dryRun: boolean,
    hierarchy: HierarchyAdminService,
  ): Promise<void> {
    for (const team of TEAMS) {
      const existing = await this.repo.getTeam(team.id);
      if (!existing) {
        entries.push({
          kind: 'team',
          id: team.id,
          label: team.name,
          action: 'create',
          detail: team.streamId,
        });
        if (!dryRun) {
          await hierarchy.createTeam({
            id: team.id,
            programmeId: PROGRAMME.id,
            streamId: team.streamId,
            name: team.name,
            sortOrder: team.sortOrder,
          });
        }
        continue;
      }
      const differs =
        existing.name !== team.name ||
        existing.sortOrder !== team.sortOrder ||
        !existing.active;
      if (differs) {
        entries.push({
          kind: 'team',
          id: team.id,
          label: team.name,
          action: 'update',
          detail: team.streamId,
        });
        if (!dryRun) {
          await hierarchy.updateTeam({
            id: team.id,
            name: team.name,
            sortOrder: team.sortOrder,
            active: true,
          });
        }
        continue;
      }
      entries.push({
        kind: 'team',
        id: team.id,
        label: team.name,
        action: 'noop',
        detail: team.streamId,
      });
    }
  }

  // --- sprint + checkpoints -------------------------------------------------

  private async reconcileSprint(
    entries: PilotPlanEntry[],
    dryRun: boolean,
    hierarchy: HierarchyAdminService,
  ): Promise<void> {
    const existingSprint = await this.repo.getSprint(PILOT_SPRINT.id);
    if (!existingSprint) {
      entries.push({ kind: 'sprint', id: PILOT_SPRINT.id, label: PILOT_SPRINT.label, action: 'create' });
      entries.push({
        kind: 'checkpoint',
        id: PILOT_CHECKPOINT_W1_ID,
        label: 'Week 1',
        action: 'create',
        detail: 'CURRENT',
      });
      entries.push({
        kind: 'checkpoint',
        id: PILOT_CHECKPOINT_W2_ID,
        label: 'Week 2',
        action: 'create',
        detail: 'UPCOMING',
      });
      if (!dryRun) {
        // createSprint generates exactly the two weekly checkpoints (R2.1).
        await hierarchy.createSprint({
          id: PILOT_SPRINT.id,
          programmeId: PROGRAMME.id,
          label: PILOT_SPRINT.label,
          startDate: PILOT_SPRINT.startDate,
          endDate: PILOT_SPRINT.endDate,
        });
        // Exactly one CURRENT checkpoint — Week 1 (R2.2).
        await hierarchy.setCurrentCheckpoint(PILOT_CHECKPOINT_W1_ID);
      }
      return;
    }

    entries.push({ kind: 'sprint', id: PILOT_SPRINT.id, label: PILOT_SPRINT.label, action: 'noop' });

    // Week 1 must be the single CURRENT checkpoint. Reconcile only when needed.
    const w1 = await this.repo.getCheckpoint(PILOT_CHECKPOINT_W1_ID);
    if (w1 && w1.status !== 'CURRENT' && w1.status !== 'CLOSED') {
      entries.push({
        kind: 'checkpoint',
        id: PILOT_CHECKPOINT_W1_ID,
        label: 'Week 1',
        action: 'update',
        detail: 'set CURRENT',
      });
      if (!dryRun) await hierarchy.setCurrentCheckpoint(PILOT_CHECKPOINT_W1_ID);
    } else {
      entries.push({
        kind: 'checkpoint',
        id: PILOT_CHECKPOINT_W1_ID,
        label: 'Week 1',
        action: 'noop',
        detail: w1?.status ?? 'missing',
      });
    }

    const w2 = await this.repo.getCheckpoint(PILOT_CHECKPOINT_W2_ID);
    entries.push({
      kind: 'checkpoint',
      id: PILOT_CHECKPOINT_W2_ID,
      label: 'Week 2',
      action: 'noop',
      detail: w2?.status ?? 'missing',
    });
  }

  // --- accounts (register + approve/assign, idempotent) --------------------

  private async reconcileAccounts(
    entries: PilotPlanEntry[],
    dryRun: boolean,
    admin: AdminService,
  ): Promise<void> {
    for (const account of PILOT_ACCOUNTS) {
      await this.reconcileAccount(account, entries, dryRun, admin);
    }
  }

  private async reconcileAccount(
    account: PilotAccountConfig,
    entries: PilotPlanEntry[],
    dryRun: boolean,
    admin: AdminService,
  ): Promise<void> {
    const roleLabel = account.roles.join('+');
    const existing = await this.repo.getUserByEmail(account.email);

    if (!existing) {
      entries.push({
        kind: 'account',
        id: account.id,
        label: account.email,
        action: 'create',
        detail: roleLabel,
      });
      if (!dryRun) {
        await this.registerPending(account);
        await admin.approve(account.id, {
          programmeId: PROGRAMME.id,
          teamIds: account.teamIds,
          roles: account.roles,
        });
      }
      return;
    }

    // A half-finished earlier run can leave a PENDING account — approve + assign.
    if (existing.status === 'PENDING') {
      entries.push({
        kind: 'account',
        id: existing.id,
        label: account.email,
        action: 'update',
        detail: `approve+assign (${roleLabel})`,
      });
      if (!dryRun) {
        await admin.approve(existing.id, {
          programmeId: PROGRAMME.id,
          teamIds: account.teamIds,
          roles: account.roles,
        });
      }
      return;
    }

    if (existing.status === 'ACTIVE') {
      const current = await this.repo.getAssignment(existing.id);
      const matches =
        !!current &&
        current.programmeId === PROGRAMME.id &&
        sameStringSet(current.roles, account.roles) &&
        sameStringSet(current.teamIds, account.teamIds);
      if (matches) {
        entries.push({
          kind: 'account',
          id: existing.id,
          label: account.email,
          action: 'noop',
          detail: roleLabel,
        });
        return;
      }
      entries.push({
        kind: 'account',
        id: existing.id,
        label: account.email,
        action: 'update',
        detail: `reassign (${roleLabel})`,
      });
      if (!dryRun) {
        await admin.updateAssignments(existing.id, {
          programmeId: PROGRAMME.id,
          teamIds: account.teamIds,
          roles: account.roles,
        });
      }
      return;
    }

    // REJECTED / SUSPENDED: never silently reactivate — surface, leave untouched.
    entries.push({
      kind: 'account',
      id: existing.id,
      label: account.email,
      action: 'noop',
      detail: `left unchanged (status ${existing.status})`,
    });
  }

  /** Create a PENDING account with its USER_REGISTERED audit (atomic). */
  private async registerPending(account: PilotAccountConfig): Promise<void> {
    const timestamp = new Date(this.now()).toISOString();
    const passwordHash = await this.hasher.hash(this.defaultPassword);
    const user: UserAccount = {
      id: account.id,
      email: account.email.toLowerCase(),
      displayName: account.displayName,
      passwordHash,
      status: 'PENDING',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const audit: AuditEvent = {
      id: randomUUID(),
      programmeId: SYSTEM_PROGRAMME,
      aggregateId: account.id,
      entityType: 'USER',
      entityId: account.id,
      action: 'USER_REGISTERED',
      actorSubject: account.id,
      timestamp,
      correlationId: randomUUID(),
    };
    await this.repo.createUserWithAudit({ user, audit });
  }

  private summarise(entries: PilotPlanEntry[]): PilotImportSummary {
    const summary: PilotImportSummary = { create: 0, update: 0, noop: 0, total: entries.length };
    for (const entry of entries) {
      summary[entry.action] += 1;
    }
    return summary;
  }
}
