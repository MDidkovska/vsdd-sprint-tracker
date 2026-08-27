/**
 * Deep-link tests (task 9.3).
 *
 * Covers the pure serialize/parse contract plus the behaviours the requirement
 * calls out: a VALID link loads the exact context; an INVALID/missing target is
 * handled safely (self-corrects instead of crashing or hanging); an
 * UNAUTHORISED target is refused by the existing RBAC (the view never renders);
 * browser Back/Forward restores context; and a copied link preserves the exact
 * team, sprint, week and version.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { createQueryClient } from './queryClient';
import { parseDeepLink, serializeDeepLink, type DeepLinkState } from './deepLink';
import { LeadershipPage } from '../features/leadership/LeadershipPage';
import { renderWithProviders } from '../test/renderApp';
import { createMockRepository } from '../api/mockRepository';
import { RepositoryProvider } from '../api/RepositoryContext';
import { AuthProvider } from '../auth/AuthProvider';
import { createMockAuthClient } from '../auth/mockAuthClient';
import { NotificationClientProvider } from '../features/notifications/NotificationClientContext';
import { createMockNotificationClient } from '../features/notifications/notificationClient';
import { VersionClientProvider } from '../features/leadership/VersionClientContext';
import { createMockVersionClient } from '../features/leadership/versionClient';

function setHash(state: DeepLinkState): void {
  window.history.replaceState(null, '', serializeDeepLink(state));
}

const LEADERSHIP_BASE: DeepLinkState = {
  view: 'leadership',
  programmeId: 'vsdd',
  streamId: 'GRMB',
  teamId: 'grmb',
  sprintId: 'S14',
  weekNumber: 1,
};

function renderAppAs(email: string): void {
  const client = createMockAuthClient({ initialUserEmail: email });
  const repository = createMockRepository({ latencyMs: 0 });
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider client={client}>
        <RepositoryProvider repository={repository}>
          <NotificationClientProvider client={createMockNotificationClient(repository)}>
            <VersionClientProvider client={createMockVersionClient(repository)}>
              <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
            </VersionClientProvider>
          </NotificationClientProvider>
        </RepositoryProvider>
      </AuthProvider>
    );
  }
  render(<App />, { wrapper: Wrapper });
}

describe('deep-link serialization', () => {
  it('round-trips a full context through the hash', () => {
    const state: DeepLinkState = {
      view: 'leadership',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'mmm-a',
      sprintId: 'S14',
      weekNumber: 2,
      versionId: 'mmm-a-S14-C14-2-v1',
    };
    expect(parseDeepLink(serializeDeepLink(state))).toEqual(state);
  });

  it('drops an unknown view and an out-of-range week', () => {
    const parsed = parseDeepLink('#/?view=hacker&team=mmm-a&week=9');
    expect(parsed.view).toBeUndefined();
    expect(parsed.weekNumber).toBeUndefined();
    expect(parsed.teamId).toBe('mmm-a');
  });

  it('returns nothing for a hash without parameters', () => {
    expect(parseDeepLink('')).toEqual({});
    expect(parseDeepLink('#/')).toEqual({});
  });
});

describe('deep-link navigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('loads the exact team referenced by a valid link', async () => {
    setHash(LEADERSHIP_BASE);
    renderWithProviders(<LeadershipPage />);
    expect(
      await screen.findByRole('heading', { name: 'PTSB-VSDD GRMB', level: 2 }),
    ).toBeInTheDocument();
  });

  it('falls back safely when the link references a team that does not exist', async () => {
    setHash({ ...LEADERSHIP_BASE, streamId: 'MMM', teamId: 'ghost-team' });
    renderWithProviders(<LeadershipPage />);
    // No crash: the hierarchy renders and the first visible team is selected.
    expect(await screen.findByLabelText('Programme hierarchy')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'PTSB-VSDD MMM A', level: 2 }),
    ).toBeInTheDocument();
  });

  it('recovers from a link that references a non-existent sprint', async () => {
    setHash({ ...LEADERSHIP_BASE, streamId: 'MMM', teamId: 'mmm-a', sprintId: 'S-BOGUS' });
    renderWithProviders(<LeadershipPage />);
    // The invalid sprint is replaced by the current sprint and the view resolves.
    expect(await screen.findByLabelText('Programme hierarchy')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'PTSB-VSDD MMM A', level: 2 }),
    ).toBeInTheDocument();
  });

  it('refuses an unauthorised view and renders the role-appropriate one instead', async () => {
    // A Team Lead may only use Team Update. A link to the Leadership View must
    // not render it (Phase 8 RBAC), redirecting to the allowed view.
    setHash({ ...LEADERSHIP_BASE, view: 'leadership' });
    renderAppAs('lead@vsdd.test');
    expect(await screen.findByRole('tab', { name: 'Team Update' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Leadership View' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Programme hierarchy')).not.toBeInTheDocument();
  });

  it('restores context on browser Back/Forward (popstate)', async () => {
    renderWithProviders(<LeadershipPage />);
    // Default context shows MMM A.
    expect(
      await screen.findByRole('heading', { name: 'PTSB-VSDD MMM A', level: 2 }),
    ).toBeInTheDocument();

    // Simulate the user navigating (back/forward) to a link for GRMB.
    act(() => {
      window.history.replaceState(null, '', serializeDeepLink(LEADERSHIP_BASE));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(
      await screen.findByRole('heading', { name: 'PTSB-VSDD GRMB', level: 2 }),
    ).toBeInTheDocument();
  });
});

describe('deep-link version preservation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('anchors the URL to the exact submitted version on screen', async () => {
    renderWithProviders(<LeadershipPage />);
    // Default team mmm-a Week 1 is submitted; its version id must reach the URL
    // so a refresh or copied address-bar link preserves the version.
    await waitFor(() =>
      expect(window.location.hash).toContain('version=mmm-a-S14-C14-1-v1'),
    );
  });

  it('copies a shareable link carrying team, sprint, week and version', async () => {
    // Note: userEvent.setup() installs its own clipboard stub, so override it
    // afterwards with a spy we can assert against.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithProviders(<LeadershipPage />);
    // Wait until the version has resolved into the context.
    await waitFor(() =>
      expect(window.location.hash).toContain('version=mmm-a-S14-C14-1-v1'),
    );

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const link = writeText.mock.calls[0]![0] as string;
    expect(link).toContain('view=leadership');
    expect(link).toContain('team=mmm-a');
    expect(link).toContain('sprint=S14');
    expect(link).toContain('week=1');
    expect(link).toContain('version=mmm-a-S14-C14-1-v1');
  });
});
