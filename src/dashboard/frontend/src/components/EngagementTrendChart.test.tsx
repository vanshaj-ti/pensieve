/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngagementTrendChart } from './EngagementTrendChart';
import type { EngagementBreakdownTrendPoint } from '../types';

describe('EngagementTrendChart', () => {
  it('renders the empty state when there are no data points', () => {
    render(<EngagementTrendChart data={[]} />);
    expect(screen.getByText('No data in this window.')).toBeInTheDocument();
  });

  it('renders a chart container when there is data', () => {
    const points: EngagementBreakdownTrendPoint[] = [
      {
        date: '2026-07-15',
        directive: 5,
        directiveNecessary: 1,
        directiveUnnecessary: 4,
        deliberative: 6,
        corrective: 1,
        acknowledgment: 2,
        total: 12,
        engagementRatio: 1.75,
        longestDirectiveBurst: 2,
        flaggedDirectives: [],
      },
      {
        date: '2026-07-16',
        directive: 2,
        directiveNecessary: 2,
        directiveUnnecessary: 0,
        deliberative: 3,
        corrective: 0,
        acknowledgment: 1,
        total: 5,
        engagementRatio: null,
        longestDirectiveBurst: 0,
        flaggedDirectives: [],
      },
    ];
    const { container } = render(<EngagementTrendChart data={points} />);
    expect(container.querySelector('.chart-container')).toBeInTheDocument();
  });
});
