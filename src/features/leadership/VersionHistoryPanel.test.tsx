/**
 * Version history + comparison UI tests (task 9.4).
 *
 * Covers the read-only history list (newest-first), opening a historical version,
 * field-level comparison (added/removed/changed, not a raw JSON diff), and the
 * empty / connection-error / permission-denied / invalid-version states. RBAC is
 * exercised via the 403 → permission-denied surface and the absence of any write
 * affordance in this read-only feature.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderApp';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { VersionError, type VersionClient } from './versionClient';
import { compareVersions } from '../../domain/versionComparison';
import type { ExceptionItem, UpdatePayload, UpdateVersion } from '../../domain/update';

function payload(over: Partial<UpdatePayload> = {}): UpdatePayload {
  return {
    goals: {
      business: 'Ship the pricing API',
      technicalTesting: 'Cover edge cases',
      sprintCommitment: 'Complete auth',
      nextWeekCommitment: 'Start reporting',
    },
    qualityEvidence: {
      planned: 20,
      executed: 15,
      passed: 12,
      openCritical: 0,
      blocked: 0,
      automationPercent: 40,
    },
    achievements: 'Shipped login\nHardened sessions',
    aiValue: {
      useCase: 'Summarise defects',
      measurableBenefit: '2h saved',
      humanValidation: 'Lead reviewed',
      nextExperimentConstraint: 'None',
    },
    exceptions: [],
    leadershipAsk: 'None',
    ...over,
  };
}

function version(n: number, over: Partial<UpdateVersion> = {}): UpdateVersion {
  return {
    id: `v${n}`,
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    versionNumber: n,
    submittedBy: `author${n}@vsdd.test`,
    submittedAt: `2026-08-2${n}T09:00:00Z`,
    schemaVersion: 1,
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload: payload(),
    ...over,
  };
}

const addedException: ExceptionItem = {
  id: 'x-1',
  type: 'BLOCKER',
  impact: 'Blocks release',
  owner: 'Sam',
  dueDate: '2026-09-01',
  decisionSupport: 'Escalate',
  status: 'OPEN',
};

const v1 = version(1);
const v2 = version(2, {
  payload: payload({
    goals: {
      business: 'Ship the pricing API v2',
      technicalTesting: 'Cover edge cases',
      sprintCommitment: 'Complete auth',
      nextWeekCommitment: 'Start reporting',
    },
    qualityEvidence: {
      planned: 20,
      executed: 15,
      passed: 12,
      openCritical: 2,
      blocked: 0,
      automationPercent: 40,
    },
    exceptions: [addedException],
  }),
});

/** A configurable in-memory version client for the UI under test. */
function fakeClient(over: Partial<VersionClient> = {}): VersionClient {
  const list = [v2, v1]; // newest first, as the backend returns
  return {
    getVersions: async () => list,
    getVersion: async (id) => {
      const found = list.find((v) => v.id === id);
      if (!found) throw new VersionError('NOT_FOUND', 'gone');
      return found;
    },
    compareVersions: async (a, b) => {
      const base = list.find((v) => v.id === a);
      const other = list.find((v) => v.id === b);
      if (!base || !other) throw new VersionError('NOT_FOUND', 'gone');
      return compareVersions(base, other);
    },
    ...over,
  };
}

function renderPanel(client: VersionClient, selectedVersionId?: string) {
  const onSelectVersion = vi.fn();
  renderWithProviders(
    <VersionHistoryPanel
      teamId="mmm-a"
      checkpointId="C14-1"
      selectedVersionId={selectedVersionId}
      onSelectVersion={onSelectVersion}
    />,
    { versionClient: client },
  );
  return { onSelectVersion };
}

describe('VersionHistoryPanel', () => {
  it('lists submitted versions newest-first with number, author and a Latest tag', async () => {
    renderPanel(fakeClient());
    const version2Row = (await screen.findByText('Version 2')).closest('li')!;
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(within(version2Row).getByText(/author2@vsdd.test/)).toBeInTheDocument();
    expect(within(version2Row).getByText('Latest')).toBeInTheDocument();
  });

  it('shows an empty state when there are no submitted versions', async () => {
    renderPanel(fakeClient({ getVersions: async () => [] }));
    expect(await screen.findByText('No submitted versions')).toBeInTheDocument();
  });

  it('surfaces an explicit connection-error state (no silent fallback)', async () => {
    renderPanel(
      fakeClient({
        getVersions: async () => {
          throw new VersionError('CONNECTION_ERROR', 'down');
        },
      }),
    );
    expect(await screen.findByText('Cannot reach the server')).toBeInTheDocument();
  });

  it('surfaces a permission-denied state when the API refuses (RBAC)', async () => {
    renderPanel(
      fakeClient({
        getVersions: async () => {
          throw new VersionError('PERMISSION_DENIED', 'no');
        },
      }),
    );
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });

  it('opens a historical version read-only and shares it via the deep link', async () => {
    const user = userEvent.setup();
    const { onSelectVersion } = renderPanel(fakeClient());
    const version1Row = (await screen.findByText('Version 1')).closest('li')!;
    await user.click(within(version1Row).getByRole('button', { name: 'View' }));
    expect(onSelectVersion).toHaveBeenCalledWith('v1');
  });

  it('renders the selected historical version content read-only', async () => {
    renderPanel(fakeClient(), 'v1');
    // v1's business goal (not the v2 variant) is shown in the read-only view.
    expect(await screen.findByText('Ship the pricing API')).toBeInTheDocument();
    expect(screen.queryByText('Ship the pricing API v2')).not.toBeInTheDocument();
  });

  it('compares two versions field by field (added/changed, not raw JSON)', async () => {
    const user = userEvent.setup();
    renderPanel(fakeClient());
    await screen.findByText('Version 2');
    const checkboxes = screen.getAllByRole('checkbox', { name: 'Compare' });
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);
    await user.click(screen.getByRole('button', { name: 'Compare selected versions' }));

    // The changed business goal appears with a "Changed" tag, and the new
    // blocker appears as "Added" — grouped by section, never as a JSON blob.
    expect(await screen.findByText('Goals & commitments')).toBeInTheDocument();
    expect(screen.getByText('Business goal')).toBeInTheDocument();
    expect(screen.getAllByText('Changed').length).toBeGreaterThan(0);
    expect(screen.getByText('Risks · Issues · Blockers')).toBeInTheDocument();
    expect(screen.getAllByText('Added').length).toBeGreaterThan(0);
  });

  it('preserves a numeric zero in the comparison (openCritical 0 → 2)', async () => {
    const user = userEvent.setup();
    renderPanel(fakeClient());
    await screen.findByText('Version 2');
    const checkboxes = screen.getAllByRole('checkbox', { name: 'Compare' });
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);
    await user.click(screen.getByRole('button', { name: 'Compare selected versions' }));

    const row = (await screen.findByText('Open critical defects')).closest('tr')!;
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('reports an invalid/deleted deep-linked version and falls back to the latest', async () => {
    renderPanel(fakeClient(), 'v-deleted');
    expect(
      await screen.findByText(/version from your link is no longer available/i),
    ).toBeInTheDocument();
    // The latest version (v2) remains the fallback target in the list.
    const version2Row = screen.getByText('Version 2').closest('li')!;
    expect(within(version2Row).getByText('Latest')).toBeInTheDocument();
  });

  it('exposes no write affordances (read-only feature)', async () => {
    renderPanel(fakeClient());
    await screen.findByText('Version 2');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record|save|submit|reopen/i })).not.toBeInTheDocument();
  });
});
