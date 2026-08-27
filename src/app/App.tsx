import { useEffect, useMemo, useRef } from 'react';
import { ToastProvider } from '../components/Toast';
import { Button } from '../components/Button';
import { useAuth } from '../auth/AuthProvider';
import type { CurrentUser } from '../api/repository';
import { SelectionProvider, useSelection, type AppView } from './selection';
import { TeamUpdatePage } from '../features/team-update/TeamUpdatePage';
import { LeadershipPage } from '../features/leadership/LeadershipPage';
import { AdminConsole } from '../features/admin/AdminConsole';
import { AuditHistory } from '../features/audit/AuditHistory';
import styles from './AppShell.module.css';

const TAB_LABELS: Record<AppView, string> = {
  team: 'Team Update',
  leadership: 'Leadership View',
  admin: 'Admin Console',
  audit: 'Audit history',
};

/**
 * The views a principal may see, in display order (role-aware navigation,
 * Phase 8 repair). A view the role cannot use is neither shown nor rendered:
 *  - Contributor / Team Lead  → Team Update;
 *  - Leadership               → Leadership View;
 *  - Admin                    → Leadership View, Admin Console, Audit history;
 *  - Auditor                  → Leadership View, Audit history (read-only).
 */
function allowedViewsFor(user: CurrentUser | null): AppView[] {
  if (!user) return [];
  const roles = user.roles;
  const views: AppView[] = [];
  if (roles.includes('CONTRIBUTOR') || roles.includes('TEAM_LEAD')) views.push('team');
  if (roles.includes('LEADERSHIP') || roles.includes('ADMIN') || roles.includes('AUDITOR')) {
    views.push('leadership');
  }
  if (roles.includes('ADMIN')) views.push('admin');
  if (roles.includes('ADMIN') || roles.includes('AUDITOR')) views.push('audit');
  return views;
}

function Header({ allowed }: { allowed: AppView[] }) {
  const { view, setView } = useSelection();
  const { user, logout } = useAuth();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = allowed.map((id) => ({ id, label: TAB_LABELS[id] }));

  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextIndex =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (nextTab) {
      setView(nextTab.id);
      tabRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.brand} aria-label="PTSB VSDD Sprint Tracker">
        <img src="/assets/ptsb-logo.png" alt="ptsb" className={styles.logo} />
        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.productName}>VSDD Sprint Tracker</span>
      </div>

      <nav className={styles.tabs} aria-label="Application views">
        <div role="tablist" aria-label="Application views" className={styles.tabs}>
          {tabs.map((tab, index) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                role="tab"
                id={`${tab.id}-tab`}
                aria-selected={active}
                aria-controls={`${tab.id}-panel`}
                tabIndex={active ? 0 : -1}
                className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => setView(tab.id)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className={styles.actions}>
        <span className={styles.badge}>Phase A · mock data</span>
        <details className={styles.profileMenu}>
          <summary className={styles.profile} aria-label="Open user menu">
            <span className={styles.avatar} aria-hidden="true">
              {user?.initials ?? '··'}
            </span>
            <span className={styles.profileLabel}>{user?.roleLabel ?? 'Loading'}</span>
          </summary>
          <div className={styles.profilePopover} role="menu">
            <p className={styles.profileName}>{user?.displayName ?? 'Signed-in user'}</p>
            <p className={styles.profileRoles}>{user ? user.email : ''}</p>
            <p className={styles.profileRoles}>
              {user ? `Roles: ${user.roles.join(', ') || 'none'}` : ''}
            </p>
            <p className={styles.profileRoles}>
              {user ? `Editable teams: ${user.assignedTeamIds.length}` : ''}
            </p>
            <Button type="button" variant="ghost" small block onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </details>
      </div>
    </header>
  );
}

/**
 * Renders only the panel for the current view AND only when that view is in the
 * allowed set — so an unauthorised view never renders even if it is selected
 * programmatically.
 */
function ViewSwitcher({ allowed }: { allowed: AppView[] }) {
  const { view } = useSelection();
  const can = (v: AppView) => allowed.includes(v);
  return (
    <main id="main-content" className={styles.main}>
      {allowed.length === 0 && (
        <p className={styles.badge}>No views are available for your role.</p>
      )}
      <div role="tabpanel" id="team-panel" aria-labelledby="team-tab" hidden={view !== 'team'}>
        {view === 'team' && can('team') && <TeamUpdatePage />}
      </div>
      <div role="tabpanel" id="leadership-panel" aria-labelledby="leadership-tab" hidden={view !== 'leadership'}>
        {view === 'leadership' && can('leadership') && <LeadershipPage />}
      </div>
      <div role="tabpanel" id="admin-panel" aria-labelledby="admin-tab" hidden={view !== 'admin'}>
        {view === 'admin' && can('admin') && <AdminConsole />}
      </div>
      <div role="tabpanel" id="audit-panel" aria-labelledby="audit-tab" hidden={view !== 'audit'}>
        {view === 'audit' && can('audit') && <AuditHistory />}
      </div>
    </main>
  );
}

/** Wires role-aware navigation: keeps the selected view within the allowed set. */
function Shell() {
  const { user } = useAuth();
  const { view, setView } = useSelection();
  const allowed = useMemo(() => allowedViewsFor(user), [user]);

  useEffect(() => {
    if (allowed.length > 0 && !allowed.includes(view)) {
      setView(allowed[0]!);
    }
  }, [allowed, view, setView]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Header allowed={allowed} />
      <ViewSwitcher allowed={allowed} />
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <SelectionProvider>
        <Shell />
      </SelectionProvider>
    </ToastProvider>
  );
}
