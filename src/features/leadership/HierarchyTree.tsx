import { cn } from '../../lib/cn';
import { STATE_LABELS } from '../../domain/update';
import type { LeadershipStreamGroup } from '../../domain/leadership';
import { StatusDot } from '../../components/StatusDot';
import styles from './Leadership.module.css';

export interface HierarchyTreeProps {
  groups: LeadershipStreamGroup[];
  collapsedStreams: Set<string>;
  selectedTeamId: string;
  selectedWeek: 1 | 2;
  onToggleStream: (streamId: string) => void;
  onSelectTeam: (teamId: string, streamId: string) => void;
  onSelectWeek: (week: 1 | 2) => void;
}

/**
 * Programme -> Stream -> Team hierarchy. Expansion works by click/keyboard
 * (never hover). Selecting a team reveals its Sprint -> Week nodes.
 */
export function HierarchyTree({
  groups,
  collapsedStreams,
  selectedTeamId,
  selectedWeek,
  onToggleStream,
  onSelectTeam,
  onSelectWeek,
}: HierarchyTreeProps) {
  return (
    <div className={styles.treeBody}>
      {groups.map((group) => {
        const collapsed = collapsedStreams.has(group.stream.id);
        return (
          <section
            key={group.stream.id}
            className={cn(styles.streamNode, collapsed && styles.collapsed)}
          >
            <button
              type="button"
              className={styles.streamRow}
              aria-expanded={!collapsed}
              onClick={() => onToggleStream(group.stream.id)}
            >
              <span className={styles.chevron} aria-hidden="true">
                ⌄
              </span>
              <span>{group.stream.name}</span>
              <span className={styles.streamMeta}>
                {group.teams.length} {group.teams.length === 1 ? 'team' : 'teams'}
              </span>
            </button>

            <div className={styles.teamList}>
              {group.teams.map((cell) => {
                const selected = cell.team.id === selectedTeamId;
                return (
                  <div key={cell.team.id}>
                    <button
                      type="button"
                      className={cn(styles.teamRow, selected && styles.teamRowSelected)}
                      aria-pressed={selected}
                      onClick={() => onSelectTeam(cell.team.id, cell.streamId)}
                    >
                      <span className={styles.teamName}>{cell.team.name}</span>
                      {cell.resolved.rag ? (
                        <>
                          <StatusDot value={cell.resolved.rag.business} labelPrefix="Business" />
                          <StatusDot value={cell.resolved.rag.delivery} labelPrefix="Test delivery" />
                          <StatusDot value={cell.resolved.rag.release} labelPrefix="Release confidence" />
                        </>
                      ) : (
                        <>
                          <span className={styles.noRag} aria-label="Business: no current evidence">—</span>
                          <span className={styles.noRag} aria-label="Test delivery: no current evidence">—</span>
                          <span className={styles.noRag} aria-label="Release confidence: no current evidence">—</span>
                        </>
                      )}
                      <span className={styles.cellState}>{STATE_LABELS[cell.resolved.cellState]}</span>
                    </button>
                    {selected && (
                      <SprintWeekNodes selectedWeek={selectedWeek} onSelectWeek={onSelectWeek} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SprintWeekNodes({
  selectedWeek,
  onSelectWeek,
}: {
  selectedWeek: 1 | 2;
  onSelectWeek: (week: 1 | 2) => void;
}) {
  return (
    <div className={styles.timeline} aria-label="Sprint and week hierarchy">
      {([1, 2] as const).map((week) => {
        const current = selectedWeek === week;
        return (
          <button
            key={week}
            type="button"
            className={cn(styles.timelineRow, current && styles.timelineCurrent)}
            aria-pressed={current}
            onClick={() => onSelectWeek(week)}
          >
            <span className={styles.timelineMarker} aria-hidden="true" />
            <span>Week {week}</span>
            <span className={styles.timelineState}>{current ? 'Viewing' : 'View'}</span>
          </button>
        );
      })}
    </div>
  );
}
