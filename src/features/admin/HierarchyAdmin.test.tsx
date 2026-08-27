/**
 * HierarchyAdmin panel tests (Phase 9, task 9.5).
 *
 * Render the panel with the injected mock client and prove it creates a stream
 * (success notice) and surfaces an explicit connection error when the client
 * throws a CONNECTION_ERROR — never silently succeeding.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AdminConfigClientProvider } from './AdminConfigClientContext';
import {
  AdminConfigError,
  createMockAdminConfigClient,
  type AdminConfigClient,
} from './adminConfigClient';
import { HierarchyAdmin } from './HierarchyAdmin';

function renderWith(client: AdminConfigClient) {
  return render(
    <AdminConfigClientProvider client={client}>
      <HierarchyAdmin />
    </AdminConfigClientProvider>,
  );
}

describe('HierarchyAdmin', () => {
  it('creates a stream and shows a success notice', async () => {
    renderWith(createMockAdminConfigClient());
    await userEvent.type(screen.getByLabelText('Stream id'), 'GRMB');
    await userEvent.type(screen.getByLabelText('Stream name'), 'GRMB');
    await userEvent.click(screen.getByRole('button', { name: 'Create stream' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Stream created/i);
  });

  it('archives a team and confirms historical records remain available', async () => {
    const client = createMockAdminConfigClient();
    await client.createTeam({ id: 'arch-a', programmeId: 'vsdd', streamId: 'MMM', name: 'Archive A' });
    renderWith(client);
    await userEvent.type(screen.getByLabelText('Archive team id'), 'arch-a');
    await userEvent.click(screen.getByRole('button', { name: 'Archive team' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/historical submissions remain/i);
  });

  it('surfaces an explicit connection error', async () => {
    const failing: AdminConfigClient = {
      ...createMockAdminConfigClient(),
      createStream: async () => {
        throw new AdminConfigError('CONNECTION_ERROR', 'offline');
      },
    };
    renderWith(failing);
    await userEvent.type(screen.getByLabelText('Stream id'), 'X');
    await userEvent.type(screen.getByLabelText('Stream name'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Create stream' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not reach the server/i),
    );
  });
});
