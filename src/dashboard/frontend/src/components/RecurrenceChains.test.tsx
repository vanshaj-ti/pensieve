/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecurrenceChains } from './RecurrenceChains';
import type { RecurrenceChain, Insight } from '../types';

// @vitest-environment jsdom
describe('RecurrenceChains', () => {
  const insights: Insight[] = [
    {
      id: 1,
      episodeId: 1,
      category: 'exploration',
      effortClass: 'judgment',
      significanceScore: 90,
      text: 'Add tests',
      evidenceRef: 'ref1',
      verifiedByGit: true,
      recurrenceOf: null,
      createdAt: '2026-01-01',
    },
    {
      id: 2,
      episodeId: 2,
      category: 'exploration',
      effortClass: 'judgment',
      significanceScore: 88,
      text: 'Add tests',
      evidenceRef: 'ref2',
      verifiedByGit: true,
      recurrenceOf: 1,
      createdAt: '2026-03-01',
    },
  ];

  const chains: RecurrenceChain[] = [
    {
      rootId: 1,
      insights,
      span: { firstDate: '2026-01-01', lastDate: '2026-03-01' },
    },
  ];

  it('renders "No recurring patterns" when empty', () => {
    render(<RecurrenceChains chains={[]} />);
    expect(screen.getByText(/no recurring/i)).toBeInTheDocument();
  });

  it('renders chains when provided', () => {
    const { container } = render(<RecurrenceChains chains={chains} />);
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('renders controls for chains', () => {
    render(<RecurrenceChains chains={chains} />);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
