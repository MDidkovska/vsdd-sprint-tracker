/**
 * Auth screen + gate tests (Phase 8).
 *
 * Drive the login/register flow, the pending-approval and access-denied states,
 * and confirm an ACTIVE user reaches the application, using the mock auth
 * client (and a small stub for the suspended case).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { axeWcag22aa } from '../../test/axe';
import type { CurrentUser } from '../../api/repository';
import type { AuthClient } from '../../auth/authClient';
import { AuthProvider } from '../../auth/AuthProvider';
import { createMockAuthClient } from '../../auth/mockAuthClient';
import { AuthGate } from './AuthGate';

function renderGate(client: AuthClient, children: ReactNode = <div>APP CONTENT</div>) {
  return render(
    <AuthProvider client={client}>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>,
  );
}

const SUSPENDED_USER: CurrentUser = {
  subject: 'u1',
  email: 'sus@vsdd.test',
  displayName: 'Suzy Suspended',
  initials: 'SS',
  roleLabel: 'Team Lead',
  status: 'SUSPENDED',
  programmeId: 'vsdd',
  roles: ['TEAM_LEAD'],
  assignedTeamIds: ['mmm-a'],
  canViewAll: false,
};

function stubClient(getMe: () => Promise<CurrentUser | null>): AuthClient {
  const fail = async () => {
    throw new Error('not used');
  };
  return {
    getMe,
    register: fail,
    login: fail,
    logout: async () => undefined,
    listUsers: fail,
    approve: fail,
    reject: fail,
    updateAssignments: fail,
    suspend: fail,
    listAudit: fail,
  };
}

describe('AuthGate', () => {
  it('shows the sign-in screen when anonymous', async () => {
    renderGate(createMockAuthClient());
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in an active user and reveals the application', async () => {
    renderGate(createMockAuthClient());
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.type(screen.getByLabelText(/^Email/i), 'lead@vsdd.test');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
  });

  it('shows an error for a wrong password', async () => {
    renderGate(createMockAuthClient());
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.type(screen.getByLabelText(/^Email/i), 'lead@vsdd.test');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
  });

  it('registers a new account and shows the pending confirmation', async () => {
    renderGate(createMockAuthClient());
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    await screen.findByRole('heading', { name: 'Create an account' });
    await userEvent.type(screen.getByLabelText(/^Display name/i), 'Newbie');
    await userEvent.type(screen.getByLabelText(/^Email/i), 'newbie@vsdd.test');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'a-good-password');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByRole('heading', { name: 'Registration received' })).toBeInTheDocument();
  });

  it('shows the pending-approval screen for a signed-in PENDING account', async () => {
    renderGate(createMockAuthClient({ initialUserEmail: 'pending@vsdd.test' }));
    expect(await screen.findByRole('heading', { name: 'Awaiting approval' })).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
  });

  it('shows access denied for a suspended account', async () => {
    renderGate(stubClient(async () => SUSPENDED_USER));
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });

  it('the sign-in screen has no WCAG 2.2 AA accessibility violations', async () => {
    const { container } = renderGate(createMockAuthClient());
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(await axeWcag22aa(container)).toHaveNoViolations();
  });
});
