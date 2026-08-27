/**
 * Admin Console (Phase 8, task 8.5).
 *
 * Lets an administrator work the approval queue and manage accounts: pending
 * users (approve with programme/team/role assignment, or reject), active users
 * (modify assignment, suspend), suspended users, and the persisted audit
 * history (via the shared read-only {@link AuditHistory} component). All calls
 * go through the auth client; the backend enforces authorisation and the
 * "never act on your own account" rule.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { PROGRAMME_ID } from '../../config';
import type { Role } from '../../api/repository';
import { AuthError, type AssignmentInput, type PublicUser } from '../../auth/authClient';
import { useAuth } from '../../auth/AuthProvider';
import { AuditHistory } from '../audit/AuditHistory';
import { HierarchyAdmin } from './HierarchyAdmin';
import { useAdminConfigClient } from './AdminConfigClientContext';
import type { Team } from '../../domain/hierarchy';
import styles from './Admin.module.css';

const ALL_ROLES: Role[] = ['CONTRIBUTOR', 'TEAM_LEAD', 'LEADERSHIP', 'ADMIN', 'AUDITOR'];
type Tab = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'AUDIT' | 'CONFIG';

interface Draft {
  roles: Set<Role>;
  teamIds: Set<string>;
}

function draftFor(user: PublicUser): Draft {
  return { roles: new Set(user.roles), teamIds: new Set(user.teamIds) };
}

export function AdminConsole() {
  const { client } = useAuth();
  const configClient = useAdminConfigClient();
  const [tab, setTab] = useState<Tab>('PENDING');
  const [teams, setTeams] = useState<Team[]>([]);
  const [pending, setPending] = useState<PublicUser[]>([]);
  const [active, setActive] = useState<PublicUser[]>([]);
  const [suspended, setSuspended] = useState<PublicUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a, s] = await Promise.all([
        client.listUsers('PENDING'),
        client.listUsers('ACTIVE'),
        client.listUsers('SUSPENDED'),
      ]);
      setPending(p);
      setActive(a);
      setSuspended(s);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const u of [...p, ...a]) if (!next[u.id]) next[u.id] = draftFor(u);
        return next;
      });
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Active teams for the assignment editor come from the real hierarchy/config
  // API (mock only under VITE_AUTH_MODE=mock), never the static frontend seed.
  // Refetching on tab change makes a newly created team immediately assignable.
  useEffect(() => {
    let cancelled = false;
    configClient
      .listActiveTeams()
      .then((t) => {
        if (!cancelled) setTeams(t);
      })
      .catch(() => {
        // Team options unavailable; the editor still renders and other actions work.
      });
    return () => {
      cancelled = true;
    };
  }, [configClient, tab]);

  const run = useCallback(
    async (action: () => Promise<PublicUser>) => {
      setError(null);
      try {
        await action();
        await reload();
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Action failed.');
      }
    },
    [reload],
  );

  function draft(userId: string): Draft {
    return drafts[userId] ?? { roles: new Set(), teamIds: new Set() };
  }

  function setDraft(userId: string, next: Draft) {
    setDrafts((prev) => ({ ...prev, [userId]: next }));
  }

  function assignmentInput(userId: string): AssignmentInput {
    const d = draft(userId);
    return { programmeId: PROGRAMME_ID, teamIds: [...d.teamIds], roles: [...d.roles] };
  }

  const rows = useMemo(
    () => ({ PENDING: pending, ACTIVE: active, SUSPENDED: suspended, AUDIT: [] as PublicUser[], CONFIG: [] as PublicUser[] }),
    [pending, active, suspended],
  );

  return (
    <section className={styles.console} aria-labelledby="admin-title">
      <h2 id="admin-title">Admin Console</h2>

      <div className={styles.tabs} role="tablist" aria-label="Admin sections">
        {(['PENDING', 'ACTIVE', 'SUSPENDED', 'AUDIT', 'CONFIG'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            className={tab === t ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(t)}
          >
            {t === 'PENDING' && `Pending (${pending.length})`}
            {t === 'ACTIVE' && `Active (${active.length})`}
            {t === 'SUSPENDED' && `Suspended (${suspended.length})`}
            {t === 'AUDIT' && 'Audit history'}
            {t === 'CONFIG' && 'Hierarchy & sprints'}
          </button>
        ))}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {loading && <p className={styles.meta}>Loading users…</p>}

      {tab === 'AUDIT' ? (
        <AuditHistory />
      ) : tab === 'CONFIG' ? (
        <HierarchyAdmin />
      ) : (
        <ul className={styles.list} aria-label={`${tab.toLowerCase()} users`}>
          {rows[tab].length === 0 && !loading && (
            <li className={styles.meta}>No {tab.toLowerCase()} users.</li>
          )}
          {rows[tab].map((user) => (
            <li key={user.id} className={styles.row}>
              <div className={styles.rowHead}>
                <div>
                  <p className={styles.name}>{user.displayName}</p>
                  <p className={styles.meta}>
                    {user.email}
                    {user.requestedTeam ? ` · requested: ${user.requestedTeam}` : ''}
                  </p>
                </div>
                <span className={styles.statusBadge}>{user.status}</span>
              </div>

              {(tab === 'PENDING' || tab === 'ACTIVE') && (
                <>
                  <div className={styles.groups}>
                    <fieldset className={styles.group}>
                      <legend className={styles.legend}>Roles</legend>
                      {ALL_ROLES.map((role) => {
                        const checked = draft(user.id).roles.has(role);
                        return (
                          <label key={role} className={styles.checkbox}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const roles = new Set(draft(user.id).roles);
                                if (e.target.checked) roles.add(role);
                                else roles.delete(role);
                                setDraft(user.id, { roles, teamIds: draft(user.id).teamIds });
                              }}
                            />
                            {role}
                          </label>
                        );
                      })}
                    </fieldset>
                    <fieldset className={styles.group}>
                      <legend className={styles.legend}>Teams</legend>
                      {teams.map((team) => {
                        const checked = draft(user.id).teamIds.has(team.id);
                        return (
                          <label key={team.id} className={styles.checkbox}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const teamIds = new Set(draft(user.id).teamIds);
                                if (e.target.checked) teamIds.add(team.id);
                                else teamIds.delete(team.id);
                                setDraft(user.id, { roles: draft(user.id).roles, teamIds });
                              }}
                            />
                            {team.name}
                          </label>
                        );
                      })}
                    </fieldset>
                  </div>

                  <div className={styles.rowActions}>
                    {tab === 'PENDING' && (
                      <>
                        <Button
                          type="button"
                          variant="primary"
                          small
                          onClick={() =>
                            void run(() => client.approve(user.id, assignmentInput(user.id)))
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          small
                          onClick={() => void run(() => client.reject(user.id))}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {tab === 'ACTIVE' && (
                      <>
                        <Button
                          type="button"
                          variant="primary"
                          small
                          onClick={() =>
                            void run(() => client.updateAssignments(user.id, assignmentInput(user.id)))
                          }
                        >
                          Save assignment
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          small
                          onClick={() => void run(() => client.suspend(user.id))}
                        >
                          Suspend
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}

              {tab === 'SUSPENDED' && (
                <p className={styles.meta}>
                  Roles: {user.roles.join(', ') || '—'} · Teams: {user.teamIds.join(', ') || '—'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
