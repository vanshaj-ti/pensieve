/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlaggedDirectivesList } from './FlaggedDirectivesList';
import type { FlaggedDirective } from '../types';

describe('FlaggedDirectivesList', () => {
  it('renders the empty state when there are no flagged directives', () => {
    render(<FlaggedDirectivesList flaggedDirectives={[]} />);
    expect(screen.getByText('No babysitting turns flagged for this scope.')).toBeInTheDocument();
  });

  it('renders line number and reason for each flagged directive', () => {
    const flagged: FlaggedDirective[] = [
      {
        humanLineNumber: 42,
        reason: 'ran tests manually; agent already had shell access',
        createdAt: '2026-07-15T00:00:00Z',
      },
      {
        humanLineNumber: 108,
        reason: 'told agent which file to edit instead of letting it search',
        createdAt: '2026-07-15T00:00:00Z',
      },
    ];

    render(<FlaggedDirectivesList flaggedDirectives={flagged} />);

    expect(screen.getByText('line 42')).toBeInTheDocument();
    expect(
      screen.getByText('ran tests manually; agent already had shell access'),
    ).toBeInTheDocument();
    expect(screen.getByText('line 108')).toBeInTheDocument();
    expect(
      screen.getByText('told agent which file to edit instead of letting it search'),
    ).toBeInTheDocument();
  });
});
