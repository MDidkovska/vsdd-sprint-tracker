import { SelectField } from '../../components/Field';
import { Button } from '../../components/Button';
import type { LeadershipFilters as Filters } from '../../domain/leadership';
import type { Stream } from '../../domain/hierarchy';
import styles from './Leadership.module.css';

export interface LeadershipFiltersProps {
  filters: Filters;
  streams: Stream[];
  onChange: (patch: Partial<Filters>) => void;
  onExport: () => void;
}

export function LeadershipFilters({ filters, streams, onChange, onExport }: LeadershipFiltersProps) {
  return (
    <div className={styles.controls} aria-label="Leadership filters">
      <SelectField
        label="Stream"
        value={filters.streamId}
        onChange={(e) => onChange({ streamId: e.target.value })}
      >
        <option value="ALL">All streams</option>
        {streams.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Status"
        value={filters.rag}
        onChange={(e) => onChange({ rag: e.target.value as Filters['rag'] })}
      >
        <option value="ALL">All</option>
        <option value="GREEN">Green</option>
        <option value="AMBER">Amber</option>
        <option value="RED">Red</option>
      </SelectField>

      <SelectField
        label="Update state"
        value={filters.state}
        onChange={(e) => onChange({ state: e.target.value as Filters['state'] })}
      >
        <option value="ALL">All</option>
        <option value="SUBMITTED">Submitted</option>
        <option value="DRAFT">Draft</option>
        <option value="REOPENED">Reopened</option>
        <option value="STALE">Stale</option>
        <option value="MISSING">Missing</option>
      </SelectField>

      <Button onClick={onExport}>Export snapshot</Button>
    </div>
  );
}
