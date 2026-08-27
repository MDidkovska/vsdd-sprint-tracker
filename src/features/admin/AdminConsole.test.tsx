/**
 * Admin Console tests (Phase 8, task 8.5; Phase 9 task 9.5 assignment-source fix).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { createMockAuthClient } from '../../auth/mockAuthClient';
import { AdminConfigClientProvider } from './AdminConfigClientContext';
import {
  createMockAdminConfigClient,
  type AdminConfigClient,
} from './adminConfigClient';
import { AdminConsole } from './AdminConsole';

function renderAsAdmin(configClient: AdminConfigClient = createMockAdminConfigClient()) {
  return render(
    <AuthProvider client={createMockAuthClient({ initialUserEmail: 'admin@vsdd.test' })}>
      <AdminConfigClientProvider client={configClient}>
        <AdminConsole />
      </AdminConfigClientProvider>
    </AuthProvider>,
  );
}

describe('AdminConsole', () => {
  it('lists the pending approval queue', async () => {
    renderAsAdmin();
    expect(await screen.findByText('Pat Pending')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pending \(1\)/ })).toBeInTheDocument();
  });

  it('approves a pending user with an assigned role and moves them to Active', async () => {
    renderAsAdmin();
    const pendingRow = (await screen.findByText('Pat Pending')).closest('li')!;
    await userEvent.click(within(pendingRow).getByRole('checkbox', { name: 'TEAM_LEAD' }));
    await userEvent.click(within(pendingRow).getByRole('button', { name: 'Approve' }));

    // Pending queue empties; the user is now Active.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Pending \(0\)/ })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('tab', { name: /Active/ }));
    expect(await screen.findByText('Pat Pending')).toBeInTheDocument();
  });

  it('shows an error when a non-admin opens the console', async () => {
    render(
      <AuthProvider client={createMockAuthClient({ initialUserEmail: 'lead@vsdd.test' })}>
        <AdminConfigClientProvider client={createMockAdminConfigClient()}>
          <AdminConsole />
        </AdminConfigClientProvider>
      </AuthProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/Administrator access is required/i);
  });

  it('shows persisted audit history including approvals', async () => {
    renderAsAdmin();
    const pendingRow = (await screen.findByText('Pat Pending')).closest('li')!;
    await userEvent.click(within(pendingRow).getByRole('checkbox', { name: 'CONTRIBUTOR' }));
    await userEvent.click(within(pendingRow).getByRole('button', { name: 'Approve' }));
    await userEvent.click(await screen.findByRole('tab', { name: 'Audit history' }));
    const history = await screen.findByRole('list', { name: 'Persisted audit history' });
    expect(within(history).getByText('USER_APPROVED')).toBeInTheDocument();
    expect(within(history).getByText('ASSIGNMENT_CHANGED')).toBeInTheDocument();
  });

  it('sources assignment team options from the hierarchy/config client, not the static seed', async () => {
    // A client returning a single distinctive team proves the editor uses the
    // injected hierarchy/config API rather than the static frontend TEAMS seed.
    const teamsClient: AdminConfigClient = {
      ...createMockAdminConfigClient(),
      listActiveTeams: async () => [
        { id: 'zzz', streamId: 'MMM', name: 'ZZZ Distinctive Team', sortOrder: 1, active: true },
      ],
    };
    renderAsAdmin(teamsClient);
    const pendingRow = (await screen.findByText('Pat Pending')).closest('li')!;
    expect(
      await within(pendingRow).findByRole('checkbox', { name: 'ZZZ Distinctive Team' }),
    ).toBeInTheDocument();
    // The static seed team names are NOT used as the source.
    expect(
      within(pendingRow).queryByRole('checkbox', { name: 'PTSB-VSDD MMM A' }),
    ).not.toBeInTheDocument();
  });
});
