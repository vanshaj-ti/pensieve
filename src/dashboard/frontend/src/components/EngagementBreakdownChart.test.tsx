/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngagementBreakdownChart } from './EngagementBreakdownChart';
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

describe('EngagementBreakdownChart', () => {
  it('renders the empty state when total is 0', () => {
    render(<EngagementBreakdownChart data={makeBreakdown({ total: 0 })} />);
    expect(screen.getByText('No classified turns for this scope.')).toBeInTheDocument();
  });

  it('renders a chart container when there is data', () => {
    const { container } = render(<EngagementBreakdownChart data={makeBreakdown()} />);
    expect(container.querySelector('.chart-container')).toBeInTheDocument();
  });
});
