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

  it('groups near-identical turns under one theme with a count instead of a flat dump', () => {
    // Real user feedback: a session with several near-identical
    // "manually ran tests" turns showed each one as a separate list item
    // with the same text repeated ("why 3 of the same... I don't need to
    // see these").
    const flagged: FlaggedDirective[] = [
      { humanLineNumber: 1, reason: 'manually ran tests', createdAt: '2026-07-15T00:00:00Z' },
      { humanLineNumber: 2, reason: 'ran tests manually again', createdAt: '2026-07-15T00:00:00Z' },
      {
        humanLineNumber: 3,
        reason: 'manually ran tests once more',
        createdAt: '2026-07-15T00:00:00Z',
      },
    ];

    render(<FlaggedDirectivesList flaggedDirectives={flagged} />);

    expect(screen.getByText('3 turns')).toBeInTheDocument();
    expect(
      screen.getByText('Manually ran/wrote tests instead of letting the agent'),
    ).toBeInTheDocument();
  });
});
