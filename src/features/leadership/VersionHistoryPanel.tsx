import { useMemo, useState } from 'react';
import { useVersionComparison, useVersionHistory } from '../../api/queries';
import { formatTimestamp } from '../../lib/datetime';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { InlineEmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { VersionError } from './versionClient';
import { VersionReadOnly } from './VersionReadOnly';
import { VersionCompare } from './VersionCompare';
import styles from './VersionHistory.module.css';

export interface VersionHistoryPanelProps {
  teamId: string;
  checkpointId: string;
  /** The version currently anchored in the deep link (task 9.3), if any. */
  selectedVersionId?: string;
  /** Persist the opened version into the selection/deep link so it is shareable. */
  onSelectVersion: (versionId: string) => void;
}

/**
 * Version history + field-level comparison (task 9.4).
 *
 * Read-only. Lists a team + checkpoint's submitted versions newest-first (number,
 * author, timestamp), opens any historical version read-only, keeps the opened
 * version in the deep link, and compares any two versions field by field. It
 * talks to the backend through the injected {@link useVersionClient} seam — the
 * real HTTP endpoints by default — and surfaces loading, empty, connection,
 * permission, session and invalid/deleted-version states explicitly.
 */
export function VersionHistoryPanel({
  teamId,
  checkpointId,
  selectedVersionId,
  onSelectVersion,
}: VersionHistoryPanelProps) {
  const historyQuery = useVersionHistory(teamId, checkpointId);
  const versions = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);

  const comparison = useVersionComparison(
    isComparing ? compareIds[0] : undefined,
    isComparing ? compareIds[1] : undefined,
  );

  function toggleCompare(versionId: string) {
    setIsComparing(false);
    setCompareIds((current) => {
      if (current.includes(versionId)) return current.filter((id) => id !== versionId);
      if (current.length >= 2) return current; // cap at two
      return [...current, versionId];
    });
  }

  // The version shown read-only: the deep-linked selection when it still exists,
  // otherwise the latest. An unknown/deleted id is reported, not trusted.
  const latestVersionId = versions[0]?.id;
  const selectedExists = selectedVersionId
    ? versions.some((v) => v.id === selectedVersionId)
    : false;
  const staleSelection = Boolean(selectedVersionId) && !selectedExists && !historyQuery.isLoading;
  const shownVersion =
    (selectedExists && versions.find((v) => v.id === selectedVersionId)) || versions[0];
  // Only render the read-only body for a HISTORICAL version. The latest version's
  // content is already shown by the surrounding Leadership detail, so repeating
  // it here would be redundant; opening an older version shows it in full.
  const showVersionBody = Boolean(shownVersion) && shownVersion?.id !== latestVersionId;

  return (
    <section className={styles.panel} aria-labelledby="version-history-heading">
      <div className={styles.panelHeadingRow}>
        <h3 id="version-history-heading">Version history</h3>
        {versions.length > 1 && (
          <p className={styles.hint}>Select two versions to compare them field by field.</p>
        )}
      </div>

      {historyQuery.isLoading ? (
        <div aria-hidden="true">
          <Skeleton height="2.5rem" />
          <div style={{ height: 'var(--space-2xs)' }} />
          <Skeleton height="2.5rem" />
        </div>
      ) : historyQuery.isError ? (
        <HistoryError error={historyQuery.error} onRetry={() => void historyQuery.refetch()} />
      ) : versions.length === 0 ? (
        <InlineEmptyState
          title="No submitted versions"
          description="This team has not submitted an update for the selected sprint and week, so there is no version history to show."
        />
      ) : (
        <>
          <ul className={styles.list}>
            {versions.map((version, index) => {
              const isSelected = shownVersion?.id === version.id;
              const isChecked = compareIds.includes(version.id);
              const disableCheck = !isChecked && compareIds.length >= 2;
              return (
                <li
                  key={version.id}
                  className={isSelected ? `${styles.row} ${styles.rowActive}` : styles.row}
                >
                  <div className={styles.rowMeta}>
                    <span className={styles.rowTitle}>
                      Version {version.versionNumber}
                      {index === 0 && <span className={styles.latestTag}>Latest</span>}
                    </span>
                    <span className={styles.rowSub}>
                      {version.submittedBy} · {formatTimestamp(version.submittedAt)}
                    </span>
                  </div>
                  <div className={styles.rowActions}>
                    <label className={styles.compareToggle}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={disableCheck}
                        onChange={() => toggleCompare(version.id)}
                      />
                      Compare
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      small
                      aria-pressed={isSelected}
                      onClick={() => onSelectVersion(version.id)}
                    >
                      View
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className={styles.compareBar}>
            {isComparing ? (
              <Button type="button" variant="ghost" small onClick={() => setIsComparing(false)}>
                Exit comparison
              </Button>
            ) : (
              <Button
                type="button"
                small
                disabled={compareIds.length !== 2}
                onClick={() => setIsComparing(true)}
              >
                Compare selected versions
              </Button>
            )}
            {compareIds.length > 0 && !isComparing && (
              <span className={styles.hint}>{compareIds.length} of 2 selected</span>
            )}
          </div>

          {staleSelection && (
            <p className={styles.hint} role="status">
              The version from your link is no longer available. Showing the latest submitted
              version instead.
            </p>
          )}

          <div className={styles.body}>
            {isComparing ? (
              comparison.isLoading ? (
                <Skeleton height="6rem" />
              ) : comparison.isError ? (
                <CompareError error={comparison.error} />
              ) : comparison.data ? (
                <VersionCompare comparison={comparison.data} />
              ) : null
            ) : showVersionBody && shownVersion ? (
              <VersionReadOnly version={shownVersion} />
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/** Map a version-client error to a human explanation + the correct affordance. */
function HistoryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { title, description, canRetry } = describeError(error);
  return (
    <ErrorState
      title={title}
      description={description}
      action={
        canRetry ? (
          <Button type="button" small variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

function CompareError({ error }: { error: unknown }) {
  const { title, description } = describeError(error);
  return <ErrorState title={title} description={description} />;
}

function describeError(error: unknown): {
  title: string;
  description: string;
  canRetry: boolean;
} {
  const code = error instanceof VersionError ? error.code : 'LOAD_FAILED';
  switch (code) {
    case 'CONNECTION_ERROR':
      return {
        title: 'Cannot reach the server',
        description:
          'Version history could not be loaded because the server was unreachable. Check your connection and try again.',
        canRetry: true,
      };
    case 'SESSION_EXPIRED':
      return {
        title: 'Your session has expired',
        description: 'Sign in again to view submitted versions.',
        canRetry: false,
      };
    case 'PERMISSION_DENIED':
      return {
        title: 'You do not have access',
        description: 'Your role does not permit viewing this team’s submitted versions.',
        canRetry: false,
      };
    case 'NOT_FOUND':
      return {
        title: 'Version not available',
        description:
          'One of the selected versions no longer exists. Refresh the history and choose again.',
        canRetry: false,
      };
    case 'VALIDATION_FAILED':
      return {
        title: 'These versions cannot be compared',
        description:
          'Comparison is only possible between two different versions of the same team, sprint and week.',
        canRetry: false,
      };
    default:
      return {
        title: 'Version history is unavailable',
        description: 'Something went wrong loading version history. Please try again.',
        canRetry: true,
      };
  }
}
