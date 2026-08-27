import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamUpdateDetail } from './TeamUpdateDetail';
import type { LeadershipTeamCell } from '../../domain/leadership';
import type { UpdatePayload } from '../../domain/update';

function payload(overrides: Partial<UpdatePayload> = {}): UpdatePayload {
  return {
    goals: { business: 'B', technicalTesting: 'T', sprintCommitment: 'S', nextWeekCommitment: 'N' },
    qualityEvidence: { planned: 10, executed: 8, passed: 7, openCritical: 0, blocked: 0, automationPercent: 20 },
    achievements: 'Did the thing.',
    aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
    exceptions: [],
    leadershipAsk: 'None',
    statusRationale: '',
    metricsNote: '',
    ...overrides,
  };
}

function cell(overrides: Partial<LeadershipTeamCell['resolved']> = {}): LeadershipTeamCell {
  return {
    team: { id: 'mmm-a', streamId: 'MMM', name: 'PTSB-VSDD MMM A', sortOrder: 1, active: true },
    streamId: 'MMM',
    resolved: {
      cellState: 'SUBMITTED',
      rag: { business: 'AMBER', delivery: 'GREEN', release: 'GREEN' },
      hasBlocker: false,
      hasLeadershipAsk: false,
      payload: payload(),
      sourceCheckpointId: 'C14-1',
      sourceWeekNumber: 1,
      submittedAt: '2026-08-25T09:14:00Z',
      isStale: false,
      isSubmittedEvidence: true,
      ...overrides,
    },
  };
}

const noop = () => {};

describe('TeamUpdateDetail evidence', () => {
  it('shows the status rationale and metric inconsistency note', () => {
    render(
      <TeamUpdateDetail
        cell={cell({
          payload: payload({
            statusRationale: 'Amber pending environment slot.',
            metricsNote: 'Re-runs counted twice.',
          }),
        })}
        sprintLabel="Sprint 14"
        weekNumber={1}
        canDecide={false}
        decisions={[]}
        onRecordDecision={noop}
      />,
    );
    expect(screen.getByText('Amber pending environment slot.')).toBeInTheDocument();
    expect(screen.getByText('Re-runs counted twice.')).toBeInTheDocument();
  });

  it('shows resolved exception evidence with resolution note', () => {
    render(
      <TeamUpdateDetail
        cell={cell({
          payload: payload({
            exceptions: [
              {
                id: 'e1',
                type: 'BLOCKER',
                impact: 'Pipeline stopped.',
                owner: 'DevOps',
                dueDate: '2026-08-27',
                decisionSupport: 'Approve rule.',
                status: 'RESOLVED',
                resolvedAt: '2026-08-27',
                resolutionNote: 'Rule approved.',
              },
            ],
          }),
        })}
        sprintLabel="Sprint 14"
        weekNumber={1}
        canDecide={false}
        decisions={[]}
        onRecordDecision={noop}
      />,
    );
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText(/Rule approved\./)).toBeInTheDocument();
  });

  it('shows a no-current-evidence state for a Missing cell (never Green)', () => {
    render(
      <TeamUpdateDetail
        cell={cell({ cellState: 'MISSING', rag: null, payload: null, isSubmittedEvidence: false })}
        sprintLabel="Sprint 14"
        weekNumber={2}
        canDecide={false}
        decisions={[]}
        onRecordDecision={noop}
      />,
    );
    expect(screen.getByText(/No current evidence/)).toBeInTheDocument();
    expect(screen.queryByText('Green')).not.toBeInTheDocument();
  });
});
