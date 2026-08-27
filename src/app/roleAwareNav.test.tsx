/**
 * Role-aware navigation tests (Phase 8 repair).
 *
 * Not every ACTIVE account sees every view. A Team Lead sees only Team Update;
 * Leadership sees Leadership View; an Admin adds the Admin Console + Audit
 * history; an Auditor sees Leadership View + a read-only Audit history and
 * NEVER the Admin Console (so it never calls /admin/users).
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { createQueryClient } from './queryClient';
import { createMockRepository } from '../api/mockRepository';
import { RepositoryProvider } from '../api/RepositoryContext';
import { AuthProvider } from '../auth/AuthProvider';
import { createMockAuthClient } from '../auth/mockAuthClient';

function renderAppAs(email: string): void {
  const client = createMockAuthClient({ initialUserEmail: email });
  const repository = createMockRepository({ latencyMs: 0 });
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider client={client}>
        <RepositoryProvider repository={repository}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </RepositoryProvider>
      </AuthProvider>
    );
  }
  render(<App />, { wrapper: Wrapper });
}

describe('role-aware navigation', () => {
  it('shows an Auditor Leadership View + Audit history, but never the Admin Console', async () => {
    renderAppAs('auditor@vsdd.test');
    expect(await screen.findByRole('tab', { name: 'Audit history' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Leadership View' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Admin Console' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team Update' })).not.toBeInTheDocument();
  });

  it('shows an Admin the Admin Console + Audit history but not Team Update', async () => {
    renderAppAs('admin@vsdd.test');
    expect(await screen.findByRole('tab', { name: 'Admin Console' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Audit history' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Leadership View' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team Update' })).not.toBeInTheDocument();
  });

  it('shows a Team Lead only Team Update', async () => {
    renderAppAs('lead@vsdd.test');
    expect(await screen.findByRole('tab', { name: 'Team Update' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Leadership View' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Admin Console' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Audit history' })).not.toBeInTheDocument();
  });

  it('does not render the Admin Console panel for an Auditor even if audit is shown', async () => {
    renderAppAs('auditor@vsdd.test');
    await screen.findByRole('tab', { name: 'Audit history' });
    // The admin panel exists in the DOM as a hidden tabpanel but must be empty
    // (AdminConsole is never mounted for a non-admin).
    expect(screen.queryByRole('heading', { name: 'Admin Console' })).not.toBeInTheDocument();
  });
});
