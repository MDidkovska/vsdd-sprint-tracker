/**
 * In-app notification service (Phase 9, task 9.1).
 *
 * The vendor-neutral business layer behind the notification endpoints:
 *   GET  /api/v1/notifications            — the caller's inbox (+ unread count)
 *   POST /api/v1/notifications/{id}/read  — mark one notification read
 *   POST /api/v1/notifications/read-all   — mark every unread notification read
 *
 * When the inbox is loaded the service GENERATES the notifications the caller
 * should have — LAZILY and IDEMPOTENTLY — with no cron / background worker /
 * scheduler. Task 9.1 generates deadline reminders (below); task 9.2 adds
 * status alerts (see {@link NotificationService.generateStatusAlerts}) for Red
 * release confidence, open Blockers and Leadership asks, sent only to ACTIVE
 * Leadership/Admin recipients. Deadline reminders:
 *  - a reminder is emitted for each team the caller may edit whose current
 *    checkpoint is DUE_SOON (deadline within 24h) or OVERDUE (deadline passed),
 *    while the update is still Draft or Missing;
 *  - once the update is submitted, no new reminder is generated (stop after
 *    submission);
 *  - the stable {@link notificationKey} prevents duplicates across reloads;
 *  - every reminder carries a task-9.3 deep link to the exact team/sprint/week.
 *
 * RECIPIENT model: reminders are generated for the CURRENT principal only, and
 * only when they are an ACTIVE Contributor or Team Lead assigned to the team
 * (task 9.1 recipient rule). Reads and writes are scoped to the caller's own
 * `subject`, so recipients are isolated and a caller can never see or mark
 * another user's notifications. Programme/team scoping is inherent: a reminder
 * is only ever generated for a team in the caller's assignment.
 *
 * Like the other services, this depends only on a narrow repository *port* and
 * the request-scoped auth context — never on MongoDB (design.md §4b).
 */
import type { AuthContext } from '../auth/mockAuth.js';
import { assertActive } from '../auth/authorization.js';
import { docKey, type UpdateDocument, type UpdateVersion } from '../domain/documents.js';
import type { ReportingCheckpoint, Sprint, Team } from '../domain/hierarchy.js';
import {
  isReportingCheckpointOpen,
  needsReminder,
  notificationKey,
  reminderCopy,
  reminderTypeFor,
  statusAlertCopy,
  statusAlertKey,
  statusAlertTypesFor,
  type Notification,
  type NotificationInbox,
} from '../domain/notifications.js';
import { ApiError } from '../http/errorEnvelope.js';

/**
 * The narrow slice of the repository the notification flow needs. Declaring it
 * here keeps the service decoupled and trivially fakeable in unit tests.
 */
export interface NotificationRepositoryPort {
  listSprints(programmeId: string): Promise<Sprint[]>;
  listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]>;
  /** All teams in a programme (status alerts fan out over the whole programme). */
  listTeams(programmeId: string): Promise<Team[]>;
  getTeam(teamId: string): Promise<Team | null>;
  getDraft(id: string): Promise<UpdateDocument | null>;
  /** Submitted versions for a team + checkpoint, newest (highest version) first. */
  listVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]>;
  insertNotificationIfAbsent(notification: Notification): Promise<boolean>;
  listNotificationsForRecipient(recipientSubject: string): Promise<Notification[]>;
  markNotificationRead(
    id: string,
    recipientSubject: string,
    readAt: string,
  ): Promise<Notification | null>;
  markAllNotificationsRead(recipientSubject: string, readAt: string): Promise<number>;
}

/** Public API consumed by the HTTP routes. */
export interface NotificationApi {
  /** Lazily generate deadline reminders, then return the caller's inbox. */
  getInbox(): Promise<NotificationInbox>;
  /** Mark one of the caller's notifications read. */
  markRead(id: string): Promise<Notification>;
  /** Mark every unread notification for the caller read. */
  markAllRead(): Promise<{ updated: number }>;
}

export class NotificationService implements NotificationApi {
  private readonly repository: NotificationRepositoryPort;
  private readonly auth: AuthContext;
  private readonly now: () => Date;

  constructor(
    repository: NotificationRepositoryPort,
    auth: AuthContext,
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.auth = auth;
    this.now = now;
  }

  async getInbox(): Promise<NotificationInbox> {
    const user = this.auth.getCurrentUser();
    assertActive(user);
    await this.generateDeadlineReminders();
    await this.generateStatusAlerts();
    const items = await this.repository.listNotificationsForRecipient(user.subject);
    const unreadCount = items.reduce((count, n) => (n.readAt ? count : count + 1), 0);
    return { items, unreadCount };
  }

  async markRead(id: string): Promise<Notification> {
    const user = this.auth.getCurrentUser();
    assertActive(user);
    const updated = await this.repository.markNotificationRead(
      id,
      user.subject,
      this.now().toISOString(),
    );
    // A missing result means the id does not exist OR belongs to another
    // recipient. Return NOT_FOUND either way so the endpoint never reveals the
    // existence of another user's notification (recipient isolation).
    if (!updated) {
      throw ApiError.notFound(`Notification "${id}" was not found.`);
    }
    return updated;
  }

  async markAllRead(): Promise<{ updated: number }> {
    const user = this.auth.getCurrentUser();
    assertActive(user);
    const updated = await this.repository.markAllNotificationsRead(
      user.subject,
      this.now().toISOString(),
    );
    return { updated };
  }

  /**
   * Lazily and idempotently generate the caller's deadline reminders. Only an
   * ACTIVE Contributor or Team Lead assigned to a team receives them (task 9.1
   * recipient rule); everyone else generates nothing and simply sees an empty
   * (own) inbox.
   */
  private async generateDeadlineReminders(): Promise<void> {
    const user = this.auth.getCurrentUser();
    const programmeId = user.programmeId;
    if (!programmeId) return;

    const isEditor = user.roles.includes('CONTRIBUTOR') || user.roles.includes('TEAM_LEAD');
    if (!isEditor) return;

    const nowMs = this.now().getTime();
    const createdAt = new Date(nowMs).toISOString();
    const sprints = await this.repository.listSprints(programmeId);

    for (const teamId of user.assignedTeamIds) {
      const team = await this.repository.getTeam(teamId);
      if (!team || !team.active) continue;

      for (const sprint of sprints) {
        const checkpoints = await this.repository.listCheckpoints(sprint.id);
        for (const checkpoint of checkpoints) {
          const type = reminderTypeFor(checkpoint, nowMs);
          if (!type) continue;

          const draft = await this.repository.getDraft(
            docKey(teamId, sprint.id, checkpoint.id),
          );
          const state = draft?.state ?? 'MISSING';
          if (!needsReminder(state)) continue; // submitted/reopened -> stop reminders

          const { title, body } = reminderCopy(type, team.name, sprint.label, checkpoint.weekNumber);
          const notification: Notification = {
            id: notificationKey(user.subject, teamId, checkpoint.id, type),
            programmeId,
            recipientSubject: user.subject,
            teamId,
            teamName: team.name,
            sprintId: sprint.id,
            sprintLabel: sprint.label,
            checkpointId: checkpoint.id,
            weekNumber: checkpoint.weekNumber,
            type,
            title,
            body,
            dueAt: checkpoint.dueAt,
            deepLink: {
              view: 'team',
              programmeId,
              streamId: team.streamId,
              teamId,
              sprintId: sprint.id,
              weekNumber: checkpoint.weekNumber,
            },
            createdAt,
          };
          await this.repository.insertNotificationIfAbsent(notification);
        }
      }
    }
  }

  /**
   * Lazily and idempotently generate the caller's STATUS ALERTS (task 9.2) for
   * the CURRENT reporting checkpoint of every team in their programme: Red
   * release confidence (RELEASE_RED), an unresolved Blocker (OPEN_BLOCKER) and
   * an active Leadership ask (LEADERSHIP_ASK).
   *
   * RECIPIENT rule: only an ACTIVE Leadership or Admin user assigned to the
   * programme receives these action alerts; a read-only Auditor (and every
   * Contributor/Team-Lead editor) generates nothing. Each principal generates
   * their OWN copy keyed by `subject`, so recipients stay isolated exactly as
   * for deadline reminders.
   *
   * Only the LATEST SUBMITTED version per team in the current checkpoint is
   * evaluated. Draft/Missing/Reopened cells, closed historical or not-yet-open
   * periods, teams in another programme and older versions never raise an
   * alert. Every alert deep-links to that exact submitted version (task 9.3).
   */
  private async generateStatusAlerts(): Promise<void> {
    const user = this.auth.getCurrentUser();
    const programmeId = user.programmeId;
    if (!programmeId) return;

    // Action alerts go only to Leadership / Admin (Auditor is read-only).
    const isLeadershipOrAdmin =
      user.roles.includes('LEADERSHIP') || user.roles.includes('ADMIN');
    if (!isLeadershipOrAdmin) return;

    const nowMs = this.now().getTime();
    const createdAt = new Date(nowMs).toISOString();
    const [teams, sprints] = await Promise.all([
      this.repository.listTeams(programmeId),
      this.repository.listSprints(programmeId),
    ]);
    const activeTeams = teams.filter((team) => team.active);

    for (const sprint of sprints) {
      const checkpoints = await this.repository.listCheckpoints(sprint.id);
      // Only the CURRENT (open) checkpoints — never a closed historical or a
      // future not-yet-open period.
      const openCheckpoints = checkpoints.filter((c) => isReportingCheckpointOpen(c, nowMs));
      if (openCheckpoints.length === 0) continue;

      for (const checkpoint of openCheckpoints) {
        for (const team of activeTeams) {
          // Only the latest submitted version counts as current evidence, and
          // only when the current-checkpoint cell is itself SUBMITTED (a
          // Draft/Missing/Reopened cell is never submitted evidence).
          const draft = await this.repository.getDraft(
            docKey(team.id, sprint.id, checkpoint.id),
          );
          if (draft?.state !== 'SUBMITTED') continue;

          const versions = await this.repository.listVersions(team.id, checkpoint.id);
          const latest = versions[0]; // newest (highest version) first
          if (!latest) continue;

          const types = statusAlertTypesFor({
            releaseRed: latest.rag.release === 'RED',
            hasBlocker: latest.hasBlocker,
            hasLeadershipAsk: latest.hasLeadershipAsk,
          });

          for (const type of types) {
            const { title, body } = statusAlertCopy(
              type,
              team.name,
              sprint.label,
              checkpoint.weekNumber,
            );
            const notification: Notification = {
              id: statusAlertKey(user.subject, latest.id, type),
              programmeId,
              recipientSubject: user.subject,
              teamId: team.id,
              teamName: team.name,
              sprintId: sprint.id,
              sprintLabel: sprint.label,
              checkpointId: checkpoint.id,
              weekNumber: checkpoint.weekNumber,
              type,
              title,
              body,
              dueAt: checkpoint.dueAt,
              deepLink: {
                view: 'leadership',
                programmeId,
                streamId: team.streamId,
                teamId: team.id,
                sprintId: sprint.id,
                weekNumber: checkpoint.weekNumber,
                versionId: latest.id,
              },
              createdAt,
            };
            await this.repository.insertNotificationIfAbsent(notification);
          }
        }
      }
    }
  }
}
