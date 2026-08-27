import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import { AuthError } from '../../auth/authClient';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

/** Sign-in screen (Phase 8). */
export function LoginScreen({ onSwitchToRegister }: { onSwitchToRegister: () => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.brand}>
          <img src="/assets/ptsb-logo.png" alt="ptsb" className={styles.logo} />
          <span>VSDD Sprint Tracker</span>
        </div>
        <h1 id="login-title" className={styles.title}>
          Sign in
        </h1>
        <p className={styles.subtitle}>Use your VSDD Sprint Tracker account.</p>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" block disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>

        <p className={styles.switcher}>
          No account?{' '}
          <button type="button" className={styles.linkButton} onClick={onSwitchToRegister}>
            Register
          </button>
        </p>
      </section>
    </main>
  );
}
