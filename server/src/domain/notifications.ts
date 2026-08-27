/**
 * In-app notification domain (Phase 9, task 9.1).
 *
 * A small, reusable in-app notification foundation. Task 9.1 populates it with
 * DEADLINE reminders (DUE_SOON / OVERDUE) for Draft and Missing updates; task
 * 9.2 adds STATUS ALERTS (RELEASE_RED / OPEN_BLOCKER / LEADERSHIP_ASK) on the
 * SAME shapes and store — so the {@link NotificationType} union carries both
 * families and nothing here is specific to deadlines beyond the reminder
 * helpers, mirrored by the status-alert helpers, at the end.
 *
 * Design decisions (task 9.1):
 *  - IN-APP ONLY: no email / Teams / Slack / webhook / external provider.
 *  - Reminders are generated LAZILY and IDEMPOTENTLY when the inbox is loaded
 *    (no cron / background worker / scheduler). Duplicates are prevented by the
 *    stable {@link notificationKey}.
 *  - Every reminder carries a task-9.3 deep link to the exact team/sprint/week.
 *
 * These shapes MIRROR the frontend domain contract (`src/domain/notifications.ts`)
 * and the OpenAPI `Notification` schema so a notification produced by this
 * backend is structurally identical to what the frontend mock produces.
 */
import type { ReportingCheckpoint } from './hierarchy.js';

/**
 * The kind of notification. Two families share the one storage/API shape:
 *  - DEADLINE reminders (task 9.1): DUE_SOON / OVERDUE;
 *  - STATUS alerts (task 9.2): RELEASE_RED / OPEN_BLOCKER / LEADERSHIP_ASK,
 *    raised from the latest submitted version in the current checkpoint.
 */
export type NotificationType =
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'RELEASE_RED'
  | 'OPEN_BLOCKER'
  | 'LEADERSHIP_ASK';

/** The deadline-reminder subset of {@link NotificationType} (task 9.1). */
export const DEADLINE_REMINDER_TYPES: readonly NotificationType[] = ['DUE_SOON', 'OVERDUE'];

/**
 * The status-alert subset of {@link NotificationType} (task 9.2): Red release
 * confidence, an unresolved Blocker and an active Leadership ask on the latest
 * submitted version. Each is a distinct type so it de-duplicates independently.
 */
export const STATUS_ALERT_TYPES: readonly NotificationType[] = [
  'RELEASE_RED',
  'OPEN_BLOCKER',
  'LEADERSHIP_ASK',
];

/**
 * The exact context a notification deep-links to (task 9.3). Mirrors the
 * frontend `DeepLinkState` fields the deep-link serializer consumes, so the UI
 * can turn this into a real hash link without any drift.
 */
export interface NotificationDeepLink {
  view: 'team' | 'leadership';
  programmeId: string;
  streamId: string;
  teamId: string;
  sprintId: string;
  weekNumber: 1 | 2;
  /**
   * The exact submitted version the alert points at (task 9.2 status alerts,
   * task 9.3 version-preserving links). Deadline reminders (task 9.1) leave
   * this absent — there is no submitted version to link to yet.
   */
  versionId?: string;
}

/**
 * A single in-app notification (`notifications` collection, one document per
 * recipient). `id` is the stable {@link notificationKey} so re-generation is
 * idempotent. `readAt` is absent until the recipient marks it read.
 */
export interface Notification {
  id: string;
  programmeId: string;
  /** The stable subject id of the user this notification belongs to. */
  recipientSubject: string;
  teamId: string;
  teamName: string;
  sprintId: string;
  sprintLabel: string;
  checkpointId: string;
  weekNumber: 1 | 2;
  type: NotificationType;
  title: string;
  body: string;
  /**
   * The reporting deadline of the checkpoint this notification is about (ISO
   * datetime, UTC). For a deadline reminder it is the deadline being chased;
   * for a status alert it is the current checkpoint's deadline, kept as
   * temporal context so the stored shape stays identical across both families.
   */
  dueAt: string;
  /** Task-9.3 deep link to the exact context. */
  deepLink: NotificationDeepLink;
  createdAt: string;
  readAt?: string;
}

/** The inbox projection returned by the list endpoint. */
export interface NotificationInbox {
  items: Notification[];
  unreadCount: number;
}

/** 24 hours in milliseconds — the DUE_SOON horizon (task 9.1 decision). */
export const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The stable de-duplication key for a notification. Including the recipient,
 * the exact checkpoint, the team and the type means:
 *  - re-loading the inbox never creates a duplicate (idempotent generation);
 *  - each recipient gets their OWN copy (recipient isolation);
 *  - a DUE_SOON and a later OVERDUE for the same checkpoint are distinct rows.
 */
export function notificationKey(
  recipientSubject: string,
  teamId: string,
  checkpointId: string,
  type: NotificationType,
): string {
  return `${recipientSubject}::${teamId}::${checkpointId}::${type}`;
}

/**
 * The stable de-duplication key for a STATUS ALERT (task 9.2). Keyed by
 * recipient + the exact submitted VERSION + type (not team/checkpoint), so:
 *  - repeated inbox loads for the same version never duplicate an alert;
 *  - a NEWER submitted version with the same condition (Red / Blocker /
 *    Leadership ask) produces a distinct, unread alert linking to that newer
 *    version, rather than being suppressed as a duplicate;
 *  - each recipient gets their own copy (recipient isolation).
 */
export function statusAlertKey(
  recipientSubject: string,
  versionId: string,
  type: NotificationType,
): string {
  return `${recipientSubject}::${versionId}::${type}`;
}

/**
 * Decide which deadline reminder (if any) applies to a checkpoint at `nowMs`,
 * independent of the update's state (the caller applies the Draft/Missing gate).
 *
 *  - before the window opens                        → no reminder;
 *  - after the window has fully closed              → no reminder (not actionable);
 *  - deadline already passed (still within window)  → OVERDUE;
 *  - deadline within the next 24 hours              → DUE_SOON;
 *  - otherwise (more than 24h away)                 → no reminder.
 */
export function reminderTypeFor(
  checkpoint: Pick<ReportingCheckpoint, 'opensAt' | 'dueAt' | 'closesAt'>,
  nowMs: number,
): NotificationType | null {
  const opensAt = Date.parse(checkpoint.opensAt);
  const dueAt = Date.parse(checkpoint.dueAt);
  const closesAt = Date.parse(checkpoint.closesAt);

  if (Number.isNaN(dueAt)) return null;
  if (!Number.isNaN(opensAt) && nowMs < opensAt) return null;
  if (!Number.isNaN(closesAt) && nowMs >= closesAt) return null;

  if (nowMs >= dueAt) return 'OVERDUE';
  if (dueAt - nowMs <= DUE_SOON_WINDOW_MS) return 'DUE_SOON';
  return null;
}

/** The update states that still need a reminder — Draft or Missing (task 9.1). */
export function needsReminder(state: string): boolean {
  return state === 'DRAFT' || state === 'MISSING';
}

/** Human-readable title/body for a reminder (no user-authored content). */
export function reminderCopy(
  type: NotificationType,
  teamName: string,
  sprintLabel: string,
  weekNumber: 1 | 2,
): { title: string; body: string } {
  const context = `${teamName} — ${sprintLabel} · Week ${weekNumber}`;
  if (type === 'OVERDUE') {
    return {
      title: 'Update overdue',
      body: `The update for ${context} has passed its deadline and is still not submitted.`,
    };
  }
  return {
    title: 'Update due soon',
    body: `The update for ${context} is due within the next 24 hours.`,
  };
}

// --- status alerts (task 9.2) ---------------------------------------------

/**
 * Whether a checkpoint's reporting window is OPEN at `nowMs` (opens ≤ now <
 * closes). Status alerts (task 9.2) only ever consider the CURRENT reporting
 * checkpoint, so a closed historical period or a not-yet-open future period is
 * excluded here and can never raise an alert.
 */
export function isReportingCheckpointOpen(
  checkpoint: Pick<ReportingCheckpoint, 'opensAt' | 'closesAt'>,
  nowMs: number,
): boolean {
  const opensAt = Date.parse(checkpoint.opensAt);
  const closesAt = Date.parse(checkpoint.closesAt);
  if (!Number.isNaN(opensAt) && nowMs < opensAt) return false;
  if (!Number.isNaN(closesAt) && nowMs >= closesAt) return false;
  return true;
}

/**
 * The status-alert types raised by a single submitted version's envelope flags
 * (task 9.2). Red release confidence, an unresolved BLOCKER (`hasBlocker`) and a
 * non-"None" Leadership ask (`hasLeadershipAsk`) each map to a distinct type,
 * and a version can raise several at once (combined conditions).
 */
export function statusAlertTypesFor(flags: {
  releaseRed: boolean;
  hasBlocker: boolean;
  hasLeadershipAsk: boolean;
}): NotificationType[] {
  const types: NotificationType[] = [];
  if (flags.releaseRed) types.push('RELEASE_RED');
  if (flags.hasBlocker) types.push('OPEN_BLOCKER');
  if (flags.hasLeadershipAsk) types.push('LEADERSHIP_ASK');
  return types;
}

/**
 * Human-readable title/body for a status alert. Deliberately carries NO
 * user-authored content — only the team/sprint/week context and the alert kind
 * — so notifications never leak free-text update content (design.md §13).
 */
export function statusAlertCopy(
  type: NotificationType,
  teamName: string,
  sprintLabel: string,
  weekNumber: 1 | 2,
): { title: string; body: string } {
  const context = `${teamName} — ${sprintLabel} · Week ${weekNumber}`;
  switch (type) {
    case 'RELEASE_RED':
      return {
        title: 'Release confidence is Red',
        body: `The latest submitted update for ${context} reports Red release confidence.`,
      };
    case 'OPEN_BLOCKER':
      return {
        title: 'Open blocker raised',
        body: `The latest submitted update for ${context} has an unresolved blocker.`,
      };
    case 'LEADERSHIP_ASK':
      return {
        title: 'Leadership ask raised',
        body: `The latest submitted update for ${context} includes a leadership ask.`,
      };
    default:
      return { title: 'Update alert', body: `There is an alert for ${context}.` };
  }
}
