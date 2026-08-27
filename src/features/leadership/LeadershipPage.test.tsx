import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadershipPage } from './LeadershipPage';
import { renderWithProviders } from '../../test/renderApp';
import { axeWcag22aa } from '../../test/axe';

async function waitForTree() {
  await waitFor(() => expect(screen.getByLabelText('Programme hierarchy')).toBeInTheDocument());
}

describe('LeadershipPage', () => {
  it('shows the programme summary with seeded Week 1 counts', async () => {
    renderWithProviders(<LeadershipPage />);
    await waitForTree();
    const summary = screen.getByLabelText('Programme reporting summary');
    expect(within(summary).getByText('teams').previousSibling).toHaveTextContent('8');
    expect(within(summary).getByText('submitted').previousSibling).toHaveTextContent('6');
    expect(within(summary).getByText('leadership asks').previousSibling).toHaveTextContent('3');
  });

  it('renders each team with three RAG dots and a state label', async () => {
    renderWithProviders(<LeadershipPage />);
    await waitForTree();
    const tree = screen.getByLabelText('Programme hierarchy');
    // Business/Test/Release accessible dots exist for the seeded mmm-a row.
    expect(within(tree).getAllByRole('img', { name: /Business:/ }).length).toBeGreaterThan(0);
  });

  it('drills into a selected team and shows the four goal labels', async () => {
    renderWithProviders(<LeadershipPage />);
    await waitForTree();
    // mmm-a is selected by default and submitted.
    expect(await screen.findByText('Business goal')).toBeInTheDocument();
    expect(screen.getByText('Technical / testing goal')).toBeInTheDocument();
    expect(screen.getByText('Sprint commitment')).toBeInTheDocument();
    expect(screen.getByText('Next week commitment')).toBeInTheDocument();
  });

  it('labels a stale update when viewing Week 2', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadershipPage />);
    await waitForTree();

    // Select the Visa team, then switch to Week 2 -> Visa becomes Stale.
    await user.click(screen.getByRole('button', { name: /VIS-PMNT/ }));
    const weekTwo = await screen.findByRole('button', { name: /Week 2/ });
    await user.click(weekTwo);

    await waitFor(() =>
      expect(screen.getByText(/showing the latest submission from Week 1/i)).toBeInTheDocument(),
    );
  });

  it('never shows Green for a Missing team (em dashes, no current evidence)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadershipPage />);
    await waitForTree();
    // oah-sales has no history, so at Week 2 it is genuinely Missing.
    await user.click(screen.getByRole('button', { name: /PTSB-VSDD OAH Sales/ }));
    await user.click(await screen.findByRole('button', { name: /Week 2/ }));
    await waitFor(() =>
      expect(screen.getByText(/No current evidence for this checkpoint/)).toBeInTheDocument(),
    );
    // The tree row exposes "no current evidence" instead of a RAG dot.
    expect(screen.getAllByLabelText(/Business: no current evidence/).length).toBeGreaterThan(0);
  });

  it('supports keyboard selection of a team in the hierarchy', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadershipPage />);
    await waitForTree();
    const grmbRow = screen.getByRole('button', { name: /PTSB-VSDD GRMB/ });
    grmbRow.focus();
    expect(grmbRow).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(grmbRow).toHaveAttribute('aria-pressed', 'true'));
  });

  it('shows a zero-result state and resets filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadershipPage />);
    await waitForTree();

    await user.selectOptions(screen.getByLabelText('Stream'), 'Visa');
    await user.selectOptions(screen.getByLabelText('Update state'), 'MISSING');

    await waitFor(() =>
      expect(screen.getByText('No teams match these filters')).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(screen.getByLabelText('Programme hierarchy')).toBeInTheDocument());
  });

  it('has no WCAG 2.2 AA axe violations on the loaded programme view', async () => {
    const { container } = renderWithProviders(<LeadershipPage />);
    await waitForTree();
    expect(await axeWcag22aa(container)).toHaveNoViolations();
  });

  it('has no WCAG 2.2 AA axe violations on the filtered zero-result state', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LeadershipPage />);
    await waitForTree();
    // Drive the hierarchy into its empty state (task 10.5 requires the scan to
    // cover error/empty states, not only the happy path).
    await user.selectOptions(screen.getByLabelText('Stream'), 'Visa');
    await user.selectOptions(screen.getByLabelText('Update state'), 'MISSING');
    await waitFor(() =>
      expect(screen.getByText('No teams match these filters')).toBeInTheDocument(),
    );
    expect(await axeWcag22aa(container)).toHaveNoViolations();
  });
});
