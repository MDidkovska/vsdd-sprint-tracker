import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { TeamUpdatePage } from './TeamUpdatePage';
import { renderWithProviders } from '../../test/renderApp';
import { MockRepository } from '../../api/mockRepository';
import {
  RepositoryError,
  type CurrentUser,
  type SaveDraftInput,
} from '../../api/repository';
import type { UpdateDocument } from '../../domain/update';

function makeUser(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    subject: 'u',
    email: 'u@example.com',
    displayName: 'U',
    initials: 'U',
    roleLabel: 'role',
    status: 'ACTIVE',
    programmeId: 'vsdd',
    roles: [],
    assignedTeamIds: [],
    canViewAll: false,
    ...overrides,
  };
}

async function waitForLoaded() {
  // The default team (mmm-a) is a submitted Week 1 update.
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
}

describe('TeamUpdatePage', () => {
  it('shows a loading skeleton then the loaded update', async () => {
    renderWithProviders(<TeamUpdatePage />);
    expect(screen.getByLabelText('Loading team update')).toBeInTheDocument();
    await waitForLoaded();
    expect(screen.getByText(/Sprint 14 · Week 1 update/)).toBeInTheDocument();
  });

  it('renders the four goal fields and three RAG selectors', async () => {
    renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();
    expect(screen.getByRole('textbox', { name: /Business goal/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Technical \/ testing goal/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Sprint commitment/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Next week commitment/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Business outcome' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Test delivery' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Release confidence' })).toBeInTheDocument();
  });

  it('shows a submitted, read-only banner with a reopen action for a submitted update', async () => {
    renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();
    expect(screen.getByText(/submitted and read-only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reopen to edit/ })).toBeInTheDocument();
    // Read-only: the submit button is disabled.
    expect(screen.getByRole('button', { name: 'Submit update' })).toBeDisabled();
  });
});

describe('TeamUpdatePage permission and window states', () => {
  it('shows read-only access for an unassigned team (o24-desktop)', async () => {
    const { getByLabelText } = renderWithProviders(<TeamUpdatePage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    // Navigate context to O24 -> Desktop Sunset (unassigned).
    await userEvent.selectOptions(getByLabelText('Stream'), 'O24');
    await userEvent.selectOptions(getByLabelText('Team'), 'o24-desktop');

    await waitFor(() =>
      expect(screen.getByText(/read-only access to this team/)).toBeInTheDocument(),
    );
  });
});

describe('TeamUpdatePage submission validation (Missing draft)', () => {
  it('blocks submission and shows a linked error summary when goals are empty', async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderWithProviders(<TeamUpdatePage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    // mmm-b Week 2 is Missing -> an empty, editable draft.
    await user.selectOptions(getByLabelText('Stream'), 'MMM');
    await user.selectOptions(getByLabelText('Team'), 'mmm-b');
    await user.selectOptions(getByLabelText('Current update'), '2');

    // Wait until the empty Missing draft has loaded (business goal is cleared).
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Business goal/ })).toHaveValue(''),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Submit update' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Submit update' }));

    const heading = await screen.findByText(/Fix these before submitting/);
    const summary = heading.closest('div') as HTMLElement;
    expect(within(summary).getByText(/Business goal: This field is required\./)).toBeInTheDocument();
    // Focus moves to the first invalid goal field.
    expect(screen.getByRole('textbox', { name: /Business goal/ })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('TeamUpdatePage conflict resolution', () => {
  async function enterConflict(user: ReturnType<typeof userEvent.setup>) {
    // mmm-b Week 1 draft is armed to conflict on the next save.
    await user.selectOptions(screen.getByLabelText('Team', { exact: true }), 'mmm-b');
    const businessGoal = screen.getByRole('textbox', { name: /Business goal/ });
    await waitFor(() => expect(businessGoal).toBeEnabled());
    await user.clear(businessGoal);
    await user.type(businessGoal, 'My local edit that must not be silently overwritten.');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Version conflict — choose how to resolve/);
  }

  it('shows a conflict panel and freezes writes (no silent overwrite)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();
    await enterConflict(user);

    // Writing is frozen: Save and Submit are disabled; only explicit resolution remains.
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit update' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use server version' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Keep my version/ })).toBeInTheDocument();
  });

  it('“Use server version” resets the form to the server document', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();
    await enterConflict(user);

    await user.click(screen.getByRole('button', { name: 'Use server version' }));
    await waitFor(() =>
      expect(screen.queryByText(/Version conflict/)).not.toBeInTheDocument(),
    );
    // The edited local text is gone; the server (seed) value is restored.
    const businessGoal = screen.getByRole('textbox', { name: /Business goal/ }) as HTMLTextAreaElement;
    expect(businessGoal.value).not.toContain('must not be silently overwritten');
    expect(businessGoal.value).toMatch(/Enable the planned/);
  });
});

describe('TeamUpdatePage save failure', () => {
  it('never shows a success message after a failed save', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();
    await user.selectOptions(screen.getByLabelText('Team', { exact: true }), 'mmm-b');
    await user.selectOptions(screen.getByLabelText('Current update'), '2'); // Missing -> editable
    const ask = screen.getByRole('textbox', { name: /Leadership ask/ });
    await waitFor(() => expect(ask).toBeEnabled());
    await user.type(ask, 'Please #failsave this one');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(screen.getAllByText(/Save failed/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Draft saved for this team/)).not.toBeInTheDocument();
  });
});

// Task 10.4 — draft recovery with NO silent data loss. Covers a temporary
// network interruption, a revision conflict and a failed autosave: in every
// case the user's unsaved content must stay available for retry.
describe('TeamUpdatePage draft recovery (no silent data loss)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // (a) Temporary network interruption: the autosave/save request rejects, the
  // UI shows Save failed, the unsaved content stays in memory, and a later
  // retry (once the connection is back) succeeds.
  it('keeps unsaved content in memory after a network interruption and lets a retry succeed', async () => {
    class TransientNetworkRepo extends MockRepository {
      attempts = 0;
      override async saveDraft(input: SaveDraftInput): Promise<UpdateDocument> {
        this.attempts += 1;
        if (this.attempts === 1) {
          // First attempt fails as if the network dropped mid-request.
          throw new RepositoryError('SAVE_FAILED', 'Simulated network interruption.');
        }
        return super.saveDraft(input);
      }
    }
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />, { repository: new TransientNetworkRepo({ latencyMs: 0 }) });
    await waitForLoaded();
    await user.selectOptions(screen.getByLabelText('Team', { exact: true }), 'mmm-b');
    await user.selectOptions(screen.getByLabelText('Current update'), '2'); // Missing -> editable

    const businessGoal = screen.getByRole('textbox', { name: /Business goal/ });
    await waitFor(() => expect(businessGoal).toBeEnabled());
    const draftText = 'Draft content that must survive a dropped connection.';
    await user.clear(businessGoal);
    await user.type(businessGoal, draftText);

    // The connection is down: the save fails and no success is shown.
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getAllByText(/Save failed/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Draft saved for this team/)).not.toBeInTheDocument();

    // No silent data loss: the unsaved content is still in the editor for retry.
    expect(businessGoal).toHaveValue(draftText);

    // Retry once the connection is back: the same content saves successfully.
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft saved for this team and week\./);
    expect(businessGoal).toHaveValue(draftText);
  });

  // (b) Revision conflict: a 409/DRAFT_REVISION_CONFLICT never overwrites the
  // local content; the conflict is surfaced; and the user can recover WITHOUT
  // losing edits by keeping their version.
  it('preserves local edits on a revision conflict and recovers by keeping the local version', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();

    // mmm-b Week 1 draft is armed to conflict on the next save.
    await user.selectOptions(screen.getByLabelText('Team', { exact: true }), 'mmm-b');
    const businessGoal = screen.getByRole('textbox', { name: /Business goal/ });
    await waitFor(() => expect(businessGoal).toBeEnabled());
    const localEdit = 'Local edit that must not be lost to a version conflict.';
    await user.clear(businessGoal);
    await user.type(businessGoal, localEdit);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    // The conflict is surfaced and writes are frozen.
    await screen.findByText(/Version conflict — choose how to resolve/);
    // No silent overwrite: the local content is still present in the editor.
    expect(businessGoal).toHaveValue(localEdit);

    // Recover without losing edits: keep the local version (confirm -> overwrite).
    await user.click(screen.getByRole('button', { name: /Keep my version/ }));
    await screen.findByText(/Your version was saved over the server draft\./);
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/Version conflict/)).not.toBeInTheDocument());
    // The recovered draft still carries the user's content.
    expect(screen.getByRole('textbox', { name: /Business goal/ })).toHaveValue(localEdit);
  });

  // (c) Failed autosave (no manual click): the debounced autosave transitions
  // Saving -> Save failed and the content is retained for retry.
  it('transitions Saving to Save failed on a failed autosave and retains the content', async () => {
    class AutosaveFailRepo extends MockRepository {
      override async saveDraft(): Promise<UpdateDocument> {
        throw new RepositoryError('SAVE_FAILED', 'Simulated autosave failure.');
      }
    }
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />, { repository: new AutosaveFailRepo({ latencyMs: 0 }) });
    await waitForLoaded();
    await user.selectOptions(screen.getByLabelText('Team', { exact: true }), 'mmm-b');
    await user.selectOptions(screen.getByLabelText('Current update'), '2'); // Missing -> editable

    const businessGoal = screen.getByRole('textbox', { name: /Business goal/ });
    await waitFor(() => expect(businessGoal).toBeEnabled());
    const autosaveText = 'Autosaved content that must not silently vanish.';
    await user.type(businessGoal, autosaveText);

    // Typing shows Saving immediately (no manual Save click needed)...
    await waitFor(() => expect(screen.getAllByText(/Saving draft/).length).toBeGreaterThan(0));
    // ...then the debounced autosave fires and fails.
    await waitFor(
      () => expect(screen.getAllByText(/Save failed/).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    // No silent data loss: the content is retained for retry.
    expect(businessGoal).toHaveValue(autosaveText);
    expect(screen.queryByText(/Draft saved for this team/)).not.toBeInTheDocument();
  });
});

describe('TeamUpdatePage load error', () => {
  it('renders an error state with Retry when the update fails to load', async () => {
    class FailingRepo extends MockRepository {
      override async getUpdate(): Promise<never> {
        throw new RepositoryError('SAVE_FAILED', 'boom');
      }
    }
    renderWithProviders(<TeamUpdatePage />, { repository: new FailingRepo({ latencyMs: 0 }) });
    expect(await screen.findByText(/This update could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('TeamUpdatePage role boundaries', () => {
  it('disables Submit for a Contributor (edit only, cannot submit)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />, {
      repository: new MockRepository({ latencyMs: 0, user: makeUser({ roles: ['CONTRIBUTOR'], assignedTeamIds: ['mmm-a'] }) }),
    });
    await waitForLoaded();
    await user.selectOptions(screen.getByLabelText('Current update'), '2'); // mmm-a W2 draft
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Business goal/ })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: 'Submit update' })).toBeDisabled();
  });
});

describe('TeamUpdatePage explicit leadership ask', () => {
  it('disables the ask text when “No leadership ask” is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();
    await user.selectOptions(screen.getByLabelText('Team', { exact: true }), 'mmm-b');
    await user.selectOptions(screen.getByLabelText('Current update'), '2');
    const ask = screen.getByRole('textbox', { name: /Leadership ask/ });
    await waitFor(() => expect(ask).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: /No leadership ask this week/ }));
    expect(ask).toBeDisabled();
  });
});

describe('TeamUpdatePage accessibility', () => {
  it('has no axe violations on the loaded editable draft', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<TeamUpdatePage />);
    await waitForLoaded();
    await user.selectOptions(screen.getByLabelText('Current update'), '2'); // editable draft
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Business goal/ })).toBeEnabled(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
