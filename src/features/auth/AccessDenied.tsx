import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

/**
 * Shown when the signed-in account may not access programme data — a rejected
 * or suspended account, or (as a generic fallback) an authorised failure.
 */
export function AccessDenied({ reason }: { reason?: string }) {
  const { user, logout } = useAuth();
  const message =
    reason ??
    (user?.status === 'SUSPENDED'
      ? 'Your account has been suspended. Contact a programme administrator.'
      : user?.status === 'REJECTED'
        ? 'Your registration was not approved. Contact a programme administrator.'
        : 'You do not have permission to view this content.');
  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="denied-title">
        <span className={styles.stateIcon} aria-hidden="true">
          🚫
        </span>
        <h1 id="denied-title" className={styles.title}>
          Access denied
        </h1>
        <p className={styles.error} role="alert">
          {message}
        </p>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" block onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}
