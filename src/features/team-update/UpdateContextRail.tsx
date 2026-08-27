import { cn } from '../../lib/cn';
import { SelectField } from '../../components/Field';
import { useHierarchy, useSprints } from '../../api/queries';
import { useSelection } from '../../app/selection';
import type { CompletenessState } from './formMapping';
import styles from './TeamUpdate.module.css';

const CHECKLIST: Array<{ key: keyof Omit<CompletenessState, 'completeCount'>; label: string }> = [
  { key: 'goals', label: 'Goals & commitments' },
  { key: 'evidence', label: 'Quality evidence' },
  { key: 'ai', label: 'AI value' },
  { key: 'exceptions', label: 'Risks / issues / blockers' },
];

export interface UpdateContextRailProps {
  completeness: CompletenessState;
  /** Return false to cancel a pending context change (unsaved-work guard). */
  confirmContextChange: () => boolean;
}

export function UpdateContextRail({ completeness, confirmContextChange }: UpdateContextRailProps) {
  const { selection, setSelection } = useSelection();
  const { data: hierarchy } = useHierarchy(selection.programmeId);
  const { data: sprints } = useSprints(selection.programmeId);

  const streams = hierarchy?.streams ?? [];
  const currentStream = streams.find((s) => s.stream.id === selection.streamId);
  const teams = currentStream?.teams ?? [];

  function guard(change: () => void) {
    if (confirmContextChange()) change();
  }

  return (
    <aside className={styles.rail} aria-label="Update context">
      <div className={styles.railSection}>
        <h2>Update context</h2>
        <div className={styles.contextFields}>
          <SelectField
            label="Stream"
            value={selection.streamId}
            onChange={(e) => {
              const streamId = e.target.value;
              const firstTeam = streams.find((s) => s.stream.id === streamId)?.teams[0]?.id;
              guard(() => setSelection({ streamId, teamId: firstTeam ?? selection.teamId }));
            }}
          >
            {streams.map((s) => (
              <option key={s.stream.id} value={s.stream.id}>
                {s.stream.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Team"
            value={selection.teamId}
            onChange={(e) => guard(() => setSelection({ teamId: e.target.value }))}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Sprint"
            value={selection.sprintId}
            onChange={(e) => guard(() => setSelection({ sprintId: e.target.value }))}
          >
            {(sprints ?? []).map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.label}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Current update"
            value={String(selection.weekNumber)}
            onChange={(e) => guard(() => setSelection({ weekNumber: Number(e.target.value) as 1 | 2 }))}
          >
            <option value="1">Week 1</option>
            <option value="2">Week 2</option>
          </SelectField>
        </div>
      </div>

      <div className={styles.railSection} aria-labelledby="completeness-title">
        <div className={styles.sectionTitleRow}>
          <h2 id="completeness-title">Update completeness</h2>
          <span className={styles.completionCount}>{completeness.completeCount}/4</span>
        </div>
        <ul className={styles.completionList}>
          {CHECKLIST.map((item) => {
            const done = completeness[item.key];
            return (
              <li key={item.key} className={cn(done && styles.complete)}>
                <span className={styles.completionIcon} aria-hidden="true">
                  {done ? '✓' : ''}
                </span>
                {item.label}
                <span className="sr-only">{done ? ' complete' : ' incomplete'}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.railNote}>
        <strong>Reporting rule</strong>
        <p>Outcome first. Use counts as evidence and record only actionable exceptions.</p>
      </div>
    </aside>
  );
}
