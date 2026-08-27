/**
 * Hierarchy & reporting-cycle configuration panel (Phase 9, task 9.5).
 *
 * The Admin-only surface for configuring the programme hierarchy (streams,
 * teams) and the reporting cycle (sprints and their two weekly checkpoints)
 * WITHOUT a code deployment (R2, R17). All calls go through the injected
 * {@link AdminConfigClient}; the backend enforces Admin authorisation and every
 * invariant (unique team name within a stream, exactly two weekly checkpoints,
 * a single CURRENT checkpoint, closed-window refusal, reopen-requires-reason).
 * There is no silent fallback: an unreachable backend surfaces an explicit
 * connection error.
 */
import { useState } from 'react';
import { Button } from '../../components/Button';
import { PROGRAMME_ID } from '../../config';
import { AdminConfigError } from './adminConfigClient';
import { useAdminConfigClient } from './AdminConfigClientContext';
import styles from './Admin.module.css';

function messageFor(err: unknown): string {
  if (err instanceof AdminConfigError) {
    return err.code === 'CONNECTION_ERROR'
      ? 'Could not reach the server. Check your connection and try again.'
      : err.message;
  }
  return 'The configuration change could not be applied.';
}

/** A labelled text input using a single (aria-label) labelling mechanism. */
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      className={styles.checkbox}
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function HierarchyAdmin() {
  const client = useAdminConfigClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [streamId, setStreamId] = useState('');
  const [streamName, setStreamName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [teamStreamId, setTeamStreamId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [archiveTeamId, setArchiveTeamId] = useState('');
  const [sprintId, setSprintId] = useState('');
  const [sprintLabel, setSprintLabel] = useState('');
  const [sprintStart, setSprintStart] = useState('');
  const [sprintEnd, setSprintEnd] = useState('');
  const [checkpointId, setCheckpointId] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (err) {
      setError(messageFor(err));
    }
  }

  return (
    <section className={styles.groups} aria-labelledby="hierarchy-admin-title">
      <h3 id="hierarchy-admin-title">Hierarchy &amp; sprints</h3>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.meta} role="status">
          {notice}
        </p>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Add stream</legend>
        <Field label="Stream id" value={streamId} onChange={setStreamId} />
        <Field label="Stream name" value={streamName} onChange={setStreamName} />
        <Button
          type="button"
          variant="primary"
          small
          onClick={() =>
            void run(
              () => client.createStream({ id: streamId, programmeId: PROGRAMME_ID, name: streamName }),
              'Stream created.',
            )
          }
        >
          Create stream
        </Button>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Add team</legend>
        <Field label="Team id" value={teamId} onChange={setTeamId} />
        <Field label="Team stream id" value={teamStreamId} onChange={setTeamStreamId} />
        <Field label="Team name" value={teamName} onChange={setTeamName} />
        <Button
          type="button"
          variant="primary"
          small
          onClick={() =>
            void run(
              () =>
                client.createTeam({
                  id: teamId,
                  programmeId: PROGRAMME_ID,
                  streamId: teamStreamId,
                  name: teamName,
                }),
              'Team created.',
            )
          }
        >
          Create team
        </Button>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Archive team (keeps historical records)</legend>
        <Field label="Archive team id" value={archiveTeamId} onChange={setArchiveTeamId} />
        <Button
          type="button"
          variant="secondary"
          small
          onClick={() =>
            void run(
              () => client.archiveTeam(archiveTeamId),
              'Team archived. Its historical submissions remain available.',
            )
          }
        >
          Archive team
        </Button>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Add sprint (creates two weekly checkpoints)</legend>
        <Field label="Sprint id" value={sprintId} onChange={setSprintId} />
        <Field label="Sprint label" value={sprintLabel} onChange={setSprintLabel} />
        <Field label="Sprint start" value={sprintStart} onChange={setSprintStart} />
        <Field label="Sprint end" value={sprintEnd} onChange={setSprintEnd} />
        <Button
          type="button"
          variant="primary"
          small
          onClick={() =>
            void run(
              () =>
                client.createSprint({
                  id: sprintId,
                  programmeId: PROGRAMME_ID,
                  label: sprintLabel,
                  startDate: sprintStart,
                  endDate: sprintEnd,
                }),
              'Sprint created with two weekly checkpoints.',
            )
          }
        >
          Create sprint
        </Button>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Reporting window</legend>
        <Field label="Checkpoint id" value={checkpointId} onChange={setCheckpointId} />
        <div className={styles.rowActions}>
          <Button
            type="button"
            variant="secondary"
            small
            onClick={() =>
              void run(() => client.setCurrentCheckpoint(checkpointId), 'Checkpoint is now current.')
            }
          >
            Set current
          </Button>
          <Button
            type="button"
            variant="secondary"
            small
            onClick={() => void run(() => client.closeCheckpoint(checkpointId), 'Reporting window closed.')}
          >
            Close window
          </Button>
        </div>
        <Field label="Reopen reason" value={reopenReason} onChange={setReopenReason} />
        <Button
          type="button"
          variant="secondary"
          small
          onClick={() =>
            void run(
              () => client.reopenCheckpoint(checkpointId, reopenReason),
              'Reporting window reopened.',
            )
          }
        >
          Reopen window
        </Button>
      </fieldset>
    </section>
  );
}
