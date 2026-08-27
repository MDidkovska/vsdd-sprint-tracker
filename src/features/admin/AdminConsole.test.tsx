/**
 * Admin Console tests (Phase 8, task 8.5).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { createMockAuthClient } from '../../auth/mockAuthClient';
import { AdminConsole } from './AdminConsole';

function renderAsAdmin() {
  return render(
    <AuthProvider client={createMockAuthClient({ initialUserEmail: 'admin@vsdd.test' })}>
      <AdminConsole />
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
        <AdminConsole />
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
});
