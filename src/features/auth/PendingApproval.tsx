import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

/** Shown to a signed-in PENDING account (no programme access yet). */
export function PendingApproval() {
  const { user, logout, refresh } = useAuth();
  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="pending-title">
        <span className={styles.stateIcon} aria-hidden="true">
          ⏳
        </span>
        <h1 id="pending-title" className={styles.title}>
          Awaiting approval
        </h1>
        <p className={styles.notice}>
          Thanks{user ? `, ${user.displayName}` : ''}. Your account is registered and pending
          administrator approval. You will get access to programme data once an admin approves your
          account and assigns your team and roles.
        </p>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" block onClick={() => void refresh()}>
            Check again
          </Button>
          <Button type="button" variant="ghost" block onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}
