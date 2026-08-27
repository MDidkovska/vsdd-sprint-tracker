import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { RagSelector } from './RagSelector';
import { TextareaField } from './Field';
import { StatusDot } from './StatusDot';
import { StatusChip } from './StatusChip';
import { ExceptionEditor } from './ExceptionEditor';
import { ExceptionTable } from './ExceptionTable';
import type { ExceptionItem, RagValue } from '../domain/update';

describe('RagSelector', () => {
  it('renders a labelled radiogroup with three text options', () => {
    render(<RagSelector name="business" label="Business outcome" value="GREEN" onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'Business outcome' });
    expect(within(group).getByRole('radio', { name: 'Green' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Amber' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'Red' })).toBeInTheDocument();
  });

  it('reports selection changes and is keyboard operable', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RagSelector name="release" label="Release confidence" value="GREEN" onChange={onChange} />);
    const amber = screen.getByRole('radio', { name: 'Amber' });
    amber.focus();
    expect(amber).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('AMBER');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <RagSelector name="delivery" label="Test delivery" value="AMBER" onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('TextareaField', () => {
  it('links its error message via aria and marks the control invalid', () => {
    render(
      <TextareaField
        label="Business goal"
        required
        error="This field is required."
        defaultValue=""
      />,
    );
    const textarea = screen.getByRole('textbox', { name: /Business goal/ });
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    const errorId = textarea.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('This field is required.');
  });

  it('has no accessibility violations with a hint', async () => {
    const { container } = render(
      <TextareaField label="Sprint commitment" hint="Specific evidence the team commits to deliver." />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('StatusDot and StatusChip carry text meaning', () => {
  it('exposes an accessible name including the status word', () => {
    render(<StatusDot value={'RED' as RagValue} labelPrefix="Release" />);
    expect(screen.getByRole('img', { name: 'Release: Red' })).toBeInTheDocument();
  });

  it('renders a visible state label', () => {
    render(<StatusChip state="STALE" />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });
});

function EditorHarness({ initial }: { initial: ExceptionItem[] }) {
  const [items, setItems] = useState(initial);
  return <ExceptionEditor value={items} onChange={setItems} />;
}

const seedItem: ExceptionItem = {
  id: 'ex-1',
  type: 'RISK',
  impact: 'Environment may be unavailable.',
  owner: 'Env lead',
  dueDate: '2026-08-30',
  decisionSupport: 'Confirm slot.',
  status: 'OPEN',
};

describe('ExceptionEditor', () => {
  it('adds a new row', async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={[]} />);
    expect(screen.getByText(/No open risks/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add item' }));
    expect(screen.getByLabelText('Exception 1 type')).toBeInTheDocument();
  });

  it('edits a field', async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={[seedItem]} />);
    const owner = screen.getByLabelText('Exception 1 owner');
    await user.clear(owner);
    await user.type(owner, 'New owner');
    expect(owner).toHaveValue('New owner');
  });

  it('deletes a row and restores it with undo', async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={[seedItem]} />);
    await user.click(screen.getByRole('button', { name: /Delete risk 1/ }));
    expect(screen.getByText(/Risk removed from this draft/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Exception 1 owner')).toHaveValue('Env lead');
  });

  it('shows per-cell validation errors linked via aria-describedby', () => {
    render(
      <ExceptionEditor
        value={[{ ...seedItem, owner: '' }]}
        onChange={() => {}}
        getError={(index, field) => (field === 'owner' && index === 0 ? 'Owner is required.' : undefined)}
      />,
    );
    expect(screen.getByText('Owner is required.')).toBeInTheDocument();
    const owner = screen.getByLabelText('Exception 1 owner');
    expect(owner).toHaveAttribute('aria-invalid', 'true');
    const describedBy = owner.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent('Owner is required.');
  });

  it('reveals resolution date and note when an item is marked Resolved', async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={[seedItem]} />);
    await user.selectOptions(screen.getByLabelText('Exception 1 status'), 'RESOLVED');
    expect(screen.getByLabelText('Resolution date')).toBeInTheDocument();
    expect(screen.getByLabelText('Resolution note')).toBeInTheDocument();
  });
});

describe('ExceptionTable distinguishes open and resolved', () => {
  it('shows an explicit Resolved status and resolution note', () => {
    render(
      <ExceptionTable
        exceptions={[
          { ...seedItem, id: 'a', status: 'OPEN' },
          {
            ...seedItem,
            id: 'b',
            status: 'RESOLVED',
            resolvedAt: '2026-08-29',
            resolutionNote: 'Slot confirmed.',
          },
        ]}
      />,
    );
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText(/Slot confirmed\./)).toBeInTheDocument();
  });
});

describe('ExceptionTable (read-only)', () => {
  it('keeps Risk, Issue and Blocker distinct', () => {
    render(
      <ExceptionTable
        exceptions={[
          seedItem,
          { ...seedItem, id: 'ex-2', type: 'ISSUE' },
          { ...seedItem, id: 'ex-3', type: 'BLOCKER' },
        ]}
      />,
    );
    expect(screen.getByText('Risk')).toBeInTheDocument();
    expect(screen.getByText('Issue')).toBeInTheDocument();
    expect(screen.getByText('Blocker')).toBeInTheDocument();
  });

  it('shows an inline empty state with no exceptions', () => {
    render(<ExceptionTable exceptions={[]} />);
    expect(screen.getByText('No open exceptions')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ExceptionTable exceptions={[seedItem]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
