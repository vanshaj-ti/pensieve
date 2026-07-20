import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightList } from './InsightList';
import type { TopInsight } from '../types';

// @vitest-environment jsdom
vi.mock('../api', () => ({
  postLabel: vi.fn().mockResolvedValue({}),
}));

describe('InsightList', () => {
  const insights: TopInsight[] = [
    {
      id: 1,
      episodeId: 1,
      category: 'exploration',
      effortClass: 'judgment',
      significanceScore: 95,
      text: 'Add unit tests for auth module',
      evidenceRef: 'ref1',
      verifiedByGit: true,
      recurrenceOf: null,
      createdAt: '2026-01-01',
      projectDir: 'my-project',
      sessionId: 'session-1',
      label: 'label-1',
    },
    {
      id: 2,
      episodeId: 2,
      category: 'bug_fix',
      effortClass: 'overhead',
      significanceScore: 87,
      text: 'Optimize database queries in user service',
      evidenceRef: 'ref2',
      verifiedByGit: true,
      recurrenceOf: null,
      createdAt: '2026-01-02',
      projectDir: 'my-project',
      sessionId: 'session-1',
      label: 'label-1',
    },
    {
      id: 3,
      episodeId: 3,
      category: 'architecture_decisions',
      effortClass: 'toil',
      significanceScore: 72,
      text: 'Simplify API endpoint structure',
      evidenceRef: 'ref3',
      verifiedByGit: true,
      recurrenceOf: null,
      createdAt: '2026-01-03',
      projectDir: 'my-project',
      sessionId: 'session-1',
      label: 'label-1',
    },
  ];

  it('renders "No insights" when empty', () => {
    render(<InsightList insights={[]} onLabelSaved={vi.fn()} />);
    expect(screen.getByText(/no insights/i)).toBeInTheDocument();
  });

  it('renders insights when provided', () => {
    render(<InsightList insights={insights} onLabelSaved={vi.fn()} />);

    expect(screen.getByText('Add unit tests for auth module')).toBeInTheDocument();
    expect(screen.getByText('Optimize database queries in user service')).toBeInTheDocument();
  });

  it('renders with controls', () => {
    render(<InsightList insights={insights} onLabelSaved={vi.fn()} />);

    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
