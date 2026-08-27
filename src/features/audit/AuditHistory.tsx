/**
 * Read-only persisted audit history (Phase 8 repair).
 *
 * A shared, read-only view of the backend audit endpoint. Used by BOTH the
 * Admin Console and the Auditor's dedicated Audit view. It calls ONLY the
 * read-only `listAudit` endpoint — never any /admin/users management endpoint —
 * so it is safe to expose to an Auditor without granting user management.
 */
import { useCallback, useEffect, useState } from 'react';
import { AuthError, type AuditEntry } from '../../auth/authClient';
import { useAuth } from '../../auth/AuthProvider';
import styles from './AuditHistory.module.css';

export function AuditHistory() {
  const { client } = useAuth();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Persisted, newest-first audit history (survives restarts, visible to
      // any admin/auditor session). Read-only — no user-management calls.
      const page = await client.listAudit({ limit: 100 });
      setAudit(page.items);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not load audit history.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={styles.audit} aria-labelledby="audit-history-title">
      <h2 id="audit-history-title">Audit history</h2>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <ul className={styles.list} aria-label="Persisted audit history">
        {loading && <li className={styles.meta}>Loading audit history…</li>}
        {!loading && audit.length === 0 && (
          <li className={styles.meta}>No audit history yet.</li>
        )}
        {audit.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.action}</strong> · {entry.entityType} {entry.entityId} · by{' '}
            {entry.actorSubject} · {new Date(entry.timestamp).toLocaleString()}
          </li>
        ))}
      </ul>
    </section>
  );
}
