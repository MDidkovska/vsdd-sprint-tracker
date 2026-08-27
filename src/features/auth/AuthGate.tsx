import { useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { AccessDenied } from './AccessDenied';
import { ConnectionError } from './ConnectionError';
import { LoginScreen } from './LoginScreen';
import { PendingApproval } from './PendingApproval';
import { RegisterScreen } from './RegisterScreen';
import { SessionExpired } from './SessionExpired';
import styles from './Auth.module.css';

/**
 * Gates the application behind authentication + account status (Phase 8):
 *  - loading        → a brief loading state;
 *  - expired        → Session expired;
 *  - anonymous      → Login / Register;
 *  - PENDING        → Pending approval;
 *  - REJECTED/SUSP. → Access denied;
 *  - ACTIVE         → the application (children).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { phase, user } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  if (phase === 'loading') {
    return (
      <main className={styles.screen}>
        <section className={styles.card} aria-busy="true">
          <p className={styles.subtitle}>Loading…</p>
        </section>
      </main>
    );
  }

  if (phase === 'error') return <ConnectionError />;
  if (phase === 'expired') return <SessionExpired />;

  if (phase === 'anonymous' || !user) {
    return mode === 'login' ? (
      <LoginScreen onSwitchToRegister={() => setMode('register')} />
    ) : (
      <RegisterScreen onSwitchToLogin={() => setMode('login')} />
    );
  }

  if (user.status === 'PENDING') return <PendingApproval />;
  if (user.status === 'REJECTED' || user.status === 'SUSPENDED') return <AccessDenied />;

  return <>{children}</>;
}
