import { useEffect, useRef, useState } from 'react';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../../api/queries';
import { useSelection, type Selection } from '../../app/selection';
import type { Notification } from '../../domain/notifications';
import { Button } from '../../components/Button';
import styles from './NotificationBell.module.css';

const TYPE_LABEL: Record<Notification['type'], string> = {
  DUE_SOON: 'Due soon',
  OVERDUE: 'Overdue',
  RELEASE_RED: 'Release Red',
  OPEN_BLOCKER: 'Blocker',
  LEADERSHIP_ASK: 'Leadership ask',
};

/** The tag tone per type: danger for Overdue/Red/Blocker, warning for Due soon,
 *  accent for a Leadership ask. */
const TYPE_TAG_CLASS: Record<Notification['type'], string> = {
  DUE_SOON: styles.tagDueSoon,
  OVERDUE: styles.tagOverdue,
  RELEASE_RED: styles.tagOverdue,
  OPEN_BLOCKER: styles.tagOverdue,
  LEADERSHIP_ASK: styles.tagAsk,
};

/**
 * In-app notification bell + inbox (tasks 9.1 + 9.2).
 *
 * Shows the unread count and, on open, the current user's notifications:
 * deadline reminders (task 9.1) and status alerts for Red release confidence,
 * open Blockers and Leadership asks (task 9.2). Each notification deep-links
 * (task 9.3) to its exact context — a deadline reminder to the team/sprint/week
 * (Team Update view), a status alert to the exact submitted version (Leadership
 * View) — and is marked read on open. Loading the inbox is what lazily
 * generates the notifications on the repository.
 */
export function NotificationBell() {
  const { data, isError } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const { openTeam, setView, setSelection } = useSelection();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onOpenNotification(notification: Notification) {
    if (!notification.readAt) markRead.mutate(notification.id);
    // Deep-link to the exact context (task 9.3). A status alert (task 9.2)
    // carries a versionId and targets Leadership View at that exact submitted
    // version; a deadline reminder targets the team's Team Update view.
    const { view, programmeId, streamId, teamId, sprintId, weekNumber, versionId } =
      notification.deepLink;
    const patch: Partial<Selection> = {
      programmeId,
      streamId,
      teamId,
      sprintId,
      weekNumber,
      ...(versionId ? { versionId } : {}),
    };
    if (view === 'leadership') {
      setView('leadership');
      setSelection(patch);
    } else {
      openTeam(patch);
    }
    setOpen(false);
  }

  const label =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications, none unread';

  return (
    <div className={styles.bell} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className={styles.icon}>
          🔔
        </span>
        {unreadCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.panel} role="region" aria-label="Notifications">
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Notifications</h2>
            {unreadCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                small
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
              >
                Mark all read
              </Button>
            )}
          </div>

          {isError ? (
            <p className={styles.empty} role="alert">
              Couldn&rsquo;t load notifications. The server may be unavailable — try again shortly.
            </p>
          ) : items.length === 0 ? (
            <p className={styles.empty}>You&rsquo;re all caught up. No reminders right now.</p>
          ) : (
            <ul className={styles.list}>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.readAt ? styles.item : `${styles.item} ${styles.itemUnread}`}
                    onClick={() => onOpenNotification(n)}
                  >
                    <span className={`${styles.tag} ${TYPE_TAG_CLASS[n.type]}`}>
                      {TYPE_LABEL[n.type]}
                    </span>
                    <span className={styles.itemTitle}>{n.title}</span>
                    <span className={styles.itemBody}>{n.body}</span>
                    <span className={styles.itemContext}>
                      {n.teamName} · {n.sprintLabel} · Week {n.weekNumber}
                    </span>
                    {!n.readAt && <span className="sr-only"> (unread)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
