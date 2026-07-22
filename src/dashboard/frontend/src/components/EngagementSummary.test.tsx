/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngagementSummary } from './EngagementSummary';
import type { EngagementBreakdown } from '../types';

function makeBreakdown(overrides: Partial<EngagementBreakdown> = {}): EngagementBreakdown {
  return {
    directive: 10,
    directiveNecessary: 2,
    directiveUnnecessary: 8,
    deliberative: 15,
    corrective: 3,
    acknowledgment: 5,
    total: 33,
    engagementRatio: 2.25,
    longestDirectiveBurst: 1,
    flaggedDirectives: [],
    ...overrides,
  };
}

describe('EngagementSummary', () => {
  it('renders the empty state when total is 0', () => {
    render(<EngagementSummary breakdown={makeBreakdown({ total: 0 })} />);
    expect(screen.getByText('No classified turns for this scope.')).toBeInTheDocument();
  });

  it('reports good engagement when ratio is high', () => {
    render(<EngagementSummary breakdown={makeBreakdown({ engagementRatio: 2.25 })} />);
    expect(screen.getByText(/You're engaging well/)).toBeInTheDocument();
  });

  it('reports balanced engagement in the middle range', () => {
    render(
      <EngagementSummary
        breakdown={makeBreakdown({ engagementRatio: 1.0, deliberative: 8, corrective: 0 })}
      />,
    );
    expect(screen.getByText(/Roughly balanced/)).toBeInTheDocument();
  });

  it('reports babysitting-heavy when ratio is low', () => {
    render(
      <EngagementSummary
        breakdown={makeBreakdown({ engagementRatio: 0.3, deliberative: 2, corrective: 0 })}
      />,
    );
    expect(
      screen.getByText(/You're babysitting more than you're deliberating/),
    ).toBeInTheDocument();
  });

  it('reports no babysitting detected when ratio is null', () => {
    render(
      <EngagementSummary
        breakdown={makeBreakdown({ engagementRatio: null, directiveUnnecessary: 0 })}
      />,
    );
    expect(screen.getByText(/No babysitting detected/)).toBeInTheDocument();
  });

  it('flags a burst streak of 3 or more', () => {
    render(<EngagementSummary breakdown={makeBreakdown({ longestDirectiveBurst: 4 })} />);
    expect(screen.getByText(/longest babysitting streak was 4 turns/)).toBeInTheDocument();
  });

  it('omits the burst sentence when the streak is below 3', () => {
    render(<EngagementSummary breakdown={makeBreakdown({ longestDirectiveBurst: 2 })} />);
    expect(screen.queryByText(/longest babysitting streak/)).not.toBeInTheDocument();
  });

  it('cites the most common flagged-directive theme', () => {
    render(
      <EngagementSummary
        breakdown={makeBreakdown({
          flaggedDirectives: [
            {
              humanLineNumber: 1,
              reason: 'manually ran tests instead of letting agent iterate',
              createdAt: '2026-07-15T00:00:00Z',
            },
            {
              humanLineNumber: 2,
              reason: 'ran tests manually again',
              createdAt: '2026-07-15T00:00:00Z',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Most common babysitting pattern/)).toBeInTheDocument();
  });

  it('reports both deliberative and corrective wins', () => {
    render(<EngagementSummary breakdown={makeBreakdown({ deliberative: 5, corrective: 2 })} />);
    expect(
      screen.getByText(/resolved 5 genuine decisions and caught 2 real agent mistakes/),
    ).toBeInTheDocument();
  });

  it('reports no wins when deliberative and corrective are both 0', () => {
    render(<EngagementSummary breakdown={makeBreakdown({ deliberative: 0, corrective: 0 })} />);
    expect(
      screen.getByText('No deliberative or corrective turns recorded in this window.'),
    ).toBeInTheDocument();
  });
});
