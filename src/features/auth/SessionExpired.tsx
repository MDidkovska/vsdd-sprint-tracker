import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

/** Shown when a previously authenticated session is lost mid-use. */
export function SessionExpired() {
  const { resetToSignIn } = useAuth();
  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="expired-title">
        <span className={styles.stateIcon} aria-hidden="true">
          🔒
        </span>
        <h1 id="expired-title" className={styles.title}>
          Session expired
        </h1>
        <p className={styles.notice}>
          Your session has ended for your security. Please sign in again to continue.
        </p>
        <div className={styles.actions}>
          <Button type="button" variant="primary" block onClick={resetToSignIn}>
            Sign in again
          </Button>
        </div>
      </section>
    </main>
  );
}
