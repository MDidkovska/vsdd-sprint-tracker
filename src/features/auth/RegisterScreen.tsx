import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import { AuthError } from '../../auth/authClient';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

/** Self-registration screen (Phase 8). Creates a PENDING account. */
export function RegisterScreen({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requestedTeam, setRequestedTeam] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ displayName, email, password, requestedTeam: requestedTeam || undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className={styles.screen}>
        <section className={styles.card} aria-labelledby="register-done-title">
          <h1 id="register-done-title" className={styles.title}>
            Registration received
          </h1>
          <p className={styles.notice}>
            Your account is awaiting administrator approval. You will gain access once an admin
            approves it and assigns your team and roles.
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="primary" block onClick={onSwitchToLogin}>
              Back to sign in
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="register-title">
        <div className={styles.brand}>
          <img src="/assets/ptsb-logo.png" alt="ptsb" className={styles.logo} />
          <span>VSDD Sprint Tracker</span>
        </div>
        <h1 id="register-title" className={styles.title}>
          Create an account
        </h1>
        <p className={styles.subtitle}>An administrator approves new accounts before access.</p>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <TextField
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <TextField
            label="Requested team (optional)"
            value={requestedTeam}
            onChange={(e) => setRequestedTeam(e.target.value)}
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" block disabled={submitting}>
              {submitting ? 'Submitting…' : 'Register'}
            </Button>
          </div>
        </form>

        <p className={styles.switcher}>
          Already have an account?{' '}
          <button type="button" className={styles.linkButton} onClick={onSwitchToLogin}>
            Sign in
          </button>
        </p>
      </section>
    </main>
  );
}
