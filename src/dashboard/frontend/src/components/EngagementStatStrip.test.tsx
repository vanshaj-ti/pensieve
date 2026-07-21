/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngagementStatStrip } from './EngagementStatStrip';
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
    longestDirectiveBurst: 3,
    flaggedDirectives: [],
    ...overrides,
  };
}

describe('EngagementStatStrip', () => {
  it('renders total classified turns, ratio, babysitting count, necessary gates, and burst length', () => {
    render(<EngagementStatStrip breakdown={makeBreakdown()} />);

    expect(screen.getByText('33')).toBeInTheDocument();
    expect(screen.getByText('2.3x')).toBeInTheDocument();
    expect(screen.getByText('Good engagement : babysitting')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders "No babysitting detected" when engagementRatio is null', () => {
    render(
      <EngagementStatStrip
        breakdown={makeBreakdown({ engagementRatio: null, directiveUnnecessary: 0 })}
      />,
    );

    expect(screen.getByText('No babysitting detected')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });
});
