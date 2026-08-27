import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LEADERSHIP_FILTERS,
  type LeadershipFilters as Filters,
} from '../../domain/leadership';
import {
  queryKeys,
  useCheckpoints,
  useCurrentUser,
  useLeadershipSnapshot,
  useRecordDecision,
  useSprints,
  useVersions,
} from '../../api/queries';
import { useRepository } from '../../api/RepositoryContext';
import { useSelection } from '../../app/selection';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { applyFilters, computeSummary, flattenTeams } from './filtering';
import { LeadershipFilters } from './LeadershipFilters';
import { ProgrammeSummary } from './ProgrammeSummary';
import { HierarchyTree } from './HierarchyTree';
import { TeamUpdateDetail } from './TeamUpdateDetail';
import styles from './Leadership.module.css';

export function LeadershipPage() {
  const { selection, setSelection } = useSelection();
  const { showToast } = useToast();
  const repository = useRepository();

  const { data: user } = useCurrentUser();
  const { data: sprints } = useSprints(selection.programmeId);
  const { data: checkpoints } = useCheckpoints(selection.sprintId);
  const checkpoint = checkpoints?.find((c) => c.weekNumber === selection.weekNumber);
  const checkpointId = checkpoint?.id ?? '';

  const snapshotQuery = useLeadershipSnapshot(selection.programmeId, selection.sprintId, checkpointId);

  const [filters, setFilters] = useState<Filters>(DEFAULT_LEADERSHIP_FILTERS);
  const [collapsedStreams, setCollapsedStreams] = useState<Set<string>>(new Set());

  const sprintLabel = sprints?.find((s) => s.id === selection.sprintId)?.label ?? selection.sprintId;
  const reportingPeriodLabel = `${sprintLabel} · Week ${selection.weekNumber}`;

  const filteredGroups = useMemo(
    () => (snapshotQuery.data ? applyFilters(snapshotQuery.data, filters) : []),
    [snapshotQuery.data, filters],
  );
  const visibleTeams = useMemo(() => flattenTeams(filteredGroups), [filteredGroups]);
  const summary = useMemo(
    () => computeSummary(filteredGroups, reportingPeriodLabel),
    [filteredGroups, reportingPeriodLabel],
  );

  // Preserve the selected team if still visible; otherwise select the first
  // visible team and announce the context change (design.md §9).
  useEffect(() => {
    if (!snapshotQuery.data || visibleTeams.length === 0) return;
    const stillVisible = visibleTeams.some((t) => t.team.id === selection.teamId);
    if (!stillVisible) {
      const first = visibleTeams[0]!;
      setSelection({ teamId: first.team.id, streamId: first.streamId });
      showToast(`Showing ${first.team.name} — the previous team is hidden by the current filters.`);
    }
  }, [visibleTeams, snapshotQuery.data, selection.teamId, setSelection, showToast]);

  const selectedCell = visibleTeams.find((t) => t.team.id === selection.teamId) ?? visibleTeams[0];

  // Decisions are recorded against a submitted version.
  const versionsQuery = useVersions(
    { teamId: selection.teamId, sprintId: selection.sprintId, checkpointId },
    Boolean(checkpointId) && selectedCell?.resolved.isSubmittedEvidence === true,
  );
  const versionId = versionsQuery.data?.[0]?.id;
  const decisionsQuery = useQuery({
    queryKey: queryKeys.decisions(versionId ?? 'none'),
    queryFn: () => repository.getDecisions(versionId as string),
    enabled: Boolean(versionId),
  });
  const recordDecision = useRecordDecision();

  const canDecide = Boolean(user?.roles.includes('LEADERSHIP')) && Boolean(versionId);

  async function onExport() {
    try {
      const snapshot = await repository.export({
        programmeId: selection.programmeId,
        sprintId: selection.sprintId,
        checkpointId,
        filters,
      });
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `VSDD-${selection.sprintId}-Week-${selection.weekNumber}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`Exported ${snapshot.recordCount} filtered record(s) as JSON.`, 'success');
    } catch {
      showToast('Export failed. Try again.', 'error');
    }
  }

  function onRecordDecision(decision: string, dueDate?: string) {
    if (!versionId) return;
    recordDecision.mutate(
      { versionId, decision, dueDate },
      {
        onSuccess: () => showToast('Leadership decision recorded.', 'success'),
        onError: () => showToast('Could not record the decision.', 'error'),
      },
    );
  }

  function toggleStream(streamId: string) {
    setCollapsedStreams((current) => {
      const next = new Set(current);
      if (next.has(streamId)) next.delete(streamId);
      else next.add(streamId);
      return next;
    });
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.contextLine}>VSDD programme · Current reporting cycle</p>
          <h1 tabIndex={-1}>{reportingPeriodLabel}</h1>
        </div>
        <LeadershipFilters
          filters={filters}
          streams={(snapshotQuery.data?.streams ?? []).map((g) => g.stream)}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onExport={onExport}
        />
      </div>

      <ProgrammeSummary summary={summary} />

      {snapshotQuery.isLoading ? (
        <div className={styles.shell}>
          <div className={styles.tree}>
            <div className={styles.treeBody} style={{ padding: 'var(--space-md)' }}>
              <Skeleton height="2rem" />
              <div style={{ height: 'var(--space-sm)' }} />
              <Skeleton height="2rem" />
              <div style={{ height: 'var(--space-sm)' }} />
              <Skeleton height="2rem" />
            </div>
          </div>
          <div className={styles.detail}>
            <Skeleton width="18rem" height="1.5rem" />
          </div>
        </div>
      ) : snapshotQuery.isError ? (
        <ErrorState
          title="The programme view could not be loaded"
          description="There was a problem loading the reporting snapshot. Try again."
          action={<Button onClick={() => snapshotQuery.refetch()}>Retry</Button>}
        />
      ) : visibleTeams.length === 0 ? (
        <div className={styles.shell}>
          <div className={styles.detail} style={{ gridColumn: '1 / -1' }}>
            <EmptyState
              title="No teams match these filters"
              description="No teams match the current stream, status and update-state filters."
              action={
                <Button onClick={() => setFilters(DEFAULT_LEADERSHIP_FILTERS)}>Reset filters</Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className={styles.shell}>
          <aside className={styles.tree} aria-label="Programme hierarchy">
            <div className={styles.treeHeader}>
              <span>VSDD</span>
              <span
                className={styles.ragKey}
                aria-label="B is business outcome, T is test delivery, R is release confidence"
              >
                <span>B</span>
                <span>T</span>
                <span>R</span>
                <span>State</span>
              </span>
            </div>
            <HierarchyTree
              groups={filteredGroups}
              collapsedStreams={collapsedStreams}
              selectedTeamId={selectedCell?.team.id ?? ''}
              selectedWeek={selection.weekNumber}
              onToggleStream={toggleStream}
              onSelectTeam={(teamId, streamId) => setSelection({ teamId, streamId })}
              onSelectWeek={(week) => setSelection({ weekNumber: week })}
            />
          </aside>

          {selectedCell ? (
            <TeamUpdateDetail
              cell={selectedCell}
              sprintLabel={sprintLabel}
              weekNumber={selection.weekNumber}
              canDecide={canDecide}
              decisions={decisionsQuery.data ?? []}
              onRecordDecision={onRecordDecision}
            />
          ) : (
            <div className={styles.detail}>
              <EmptyState title="Select a team" description="Choose a team from the hierarchy to view its update." />
            </div>
          )}
        </div>
      )}
    </>
  );
}
