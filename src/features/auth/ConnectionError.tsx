import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

/**
 * Shown when the backend cannot be reached (Phase 8 repair). The app never
 * silently falls back to mock authentication — it surfaces a clear connection
 * state with a retry.
 */
export function ConnectionError() {
  const { connectionError, retryConnection } = useAuth();
  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="conn-title">
        <span className={styles.stateIcon} aria-hidden="true">
          ⚠️
        </span>
        <h1 id="conn-title" className={styles.title}>
          Can’t reach the server
        </h1>
        <p className={styles.error} role="alert">
          {connectionError ?? 'The authentication service is unavailable.'}
        </p>
        <p className={styles.subtitle}>
          Check that the API is running and reachable, then try again.
        </p>
        <div className={styles.actions}>
          <Button type="button" variant="primary" block onClick={retryConnection}>
            Try again
          </Button>
        </div>
      </section>
    </main>
  );
}
