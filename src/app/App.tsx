import { useRef } from 'react';
import { ToastProvider } from '../components/Toast';
import { useCurrentUser } from '../api/queries';
import { SelectionProvider, useSelection, type AppView } from './selection';
import { TeamUpdatePage } from '../features/team-update/TeamUpdatePage';
import { LeadershipPage } from '../features/leadership/LeadershipPage';
import styles from './AppShell.module.css';

const TABS: Array<{ id: AppView; label: string }> = [
  { id: 'team', label: 'Team Update' },
  { id: 'leadership', label: 'Leadership View' },
];

function Header() {
  const { view, setView } = useSelection();
  const { data: user } = useCurrentUser();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
    const nextTab = TABS[nextIndex];
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
          {TABS.map((tab, index) => {
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
            <p className={styles.profileRoles}>
              {user ? `Roles: ${user.roles.join(', ')}` : ''}
            </p>
            <p className={styles.profileRoles}>
              {user ? `Editable teams: ${user.assignedTeamIds.length}` : ''}
            </p>
          </div>
        </details>
      </div>
    </header>
  );
}

function ViewSwitcher() {
  const { view } = useSelection();
  return (
    <main id="main-content" className={styles.main}>
      <div role="tabpanel" id="team-panel" aria-labelledby="team-tab" hidden={view !== 'team'}>
        {view === 'team' && <TeamUpdatePage />}
      </div>
      <div role="tabpanel" id="leadership-panel" aria-labelledby="leadership-tab" hidden={view !== 'leadership'}>
        {view === 'leadership' && <LeadershipPage />}
      </div>
    </main>
  );
}

export function App() {
  return (
    <ToastProvider>
      <SelectionProvider>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <Header />
        <ViewSwitcher />
      </SelectionProvider>
    </ToastProvider>
  );
}
