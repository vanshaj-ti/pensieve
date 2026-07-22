import { describe, it, expect } from 'vitest';
import { classifyFlaggedDirective, groupFlaggedDirectivesByTheme } from './flaggedDirectiveThemes';
import type { FlaggedDirective } from './types';

describe('classifyFlaggedDirective', () => {
  it('classifies manual testing phrases', () => {
    expect(classifyFlaggedDirective('manually ran tests instead of letting agent debug')).toBe(
      'manual-testing',
    );
    expect(classifyFlaggedDirective('wrote tests by hand instead of asking agent')).toBe(
      'manual-testing',
    );
  });

  it('classifies manual code review phrases', () => {
    expect(
      classifyFlaggedDirective(
        'Human manually performed code review and specified exact fixes to apply',
      ),
    ).toBe('manual-code-review');
  });

  it('classifies redundant-order phrases', () => {
    expect(
      classifyFlaggedDirective('Told agent to continue after agent already said it was proceeding'),
    ).toBe('redundant-order');
  });

  it('classifies procedural-instruction phrases', () => {
    expect(classifyFlaggedDirective("Told agent to 'trigger manually' instead of waiting")).toBe(
      'procedural-instruction',
    );
  });

  it('falls back to other for unmatched text', () => {
    expect(classifyFlaggedDirective('Provided a file path for a config key')).toBe('other');
  });
});

describe('groupFlaggedDirectivesByTheme', () => {
  it('groups and orders by count descending', () => {
    const directives: FlaggedDirective[] = [
      { humanLineNumber: 1, reason: 'manually ran tests', createdAt: '2026-07-15T00:00:00Z' },
      { humanLineNumber: 2, reason: 'ran tests again manually', createdAt: '2026-07-15T00:00:00Z' },
      {
        humanLineNumber: 3,
        reason: 'told agent to clean up',
        createdAt: '2026-07-15T00:00:00Z',
      },
    ];
    const groups = groupFlaggedDirectivesByTheme(directives);
    expect(groups[0].theme).toBe('manual-testing');
    expect(groups[0].count).toBe(2);
    expect(groups[1].theme).toBe('procedural-instruction');
    expect(groups[1].count).toBe(1);
  });

  it('caps examples per theme', () => {
    const directives: FlaggedDirective[] = Array.from({ length: 5 }, (_, i) => ({
      humanLineNumber: i,
      reason: 'manually ran tests',
      createdAt: '2026-07-15T00:00:00Z',
    }));
    const groups = groupFlaggedDirectivesByTheme(directives);
    expect(groups[0].count).toBe(5);
    expect(groups[0].examples).toHaveLength(3);
  });
});
