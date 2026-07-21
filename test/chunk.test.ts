import { describe, it, expect } from 'vitest';
import type { ParsedLine } from '../src/ingest/parser.js';
import type { Config } from '../src/config.js';
import { bucketByDay, splitEpisodes, MAX_EPISODE_TOKENS } from '../src/chunk/episodes.js';
import { chunkSession } from '../src/chunk/index.js';
import { detectCompactionBoundaries } from '../src/chunk/compaction.js';

function createLine(
  lineNumber: number,
  type: 'user' | 'assistant',
  timestamp: string,
  hasToolUse = false,
): ParsedLine {
  return {
    lineNumber,
    type,
    timestamp,
    hasToolUse,
    raw: { type, content: 'test' },
  };
}

const defaultConfig: Config = {
  idleGapMinutes: 25,
};

describe('bucketByDay', () => {
  it('groups lines by local calendar day (YYYY-MM-DD)', () => {
    // Construct timestamps such that they differ by day in local TZ
    // Use dates that are unambiguous: line 1/2 on one day, line 3/4 on next day
    const d1 = new Date(2026, 6, 15, 10, 0, 0); // July 15
    const d2 = new Date(2026, 6, 15, 20, 0, 0); // July 15
    const d3 = new Date(2026, 6, 16, 5, 0, 0); // July 16
    const d4 = new Date(2026, 6, 16, 15, 0, 0); // July 16

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      createLine(3, 'user', d3.toISOString()),
      createLine(4, 'assistant', d4.toISOString()),
    ];

    const buckets = bucketByDay(lines);
    expect(buckets.size).toBe(2);
    expect([...buckets.keys()].sort()).toEqual(['2026-07-15', '2026-07-16']);
    expect(buckets.get('2026-07-15')).toHaveLength(2);
    expect(buckets.get('2026-07-16')).toHaveLength(2);
  });

  it('preserves line order within buckets', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 5, 0);
    const d3 = new Date(2026, 6, 15, 10, 10, 0);

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      createLine(3, 'user', d3.toISOString()),
    ];

    const buckets = bucketByDay(lines);
    const day = buckets.get('2026-07-15')!;
    expect(day.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
  });
});

describe('splitEpisodes', () => {
  it('returns empty array for empty input', () => {
    const result = splitEpisodes([], defaultConfig);
    expect(result).toEqual([]);
  });

  it('returns one episode for single line', () => {
    const lines = [createLine(1, 'user', '2026-07-15T10:00:00Z')];
    const result = splitEpisodes(lines, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0].startLine).toBe(1);
    expect(result[0].endLine).toBe(1);
    expect(result[0].lines).toEqual(lines);
  });

  it('keeps lines in one episode when gap is under threshold', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 20, 0); // 20 min gap, threshold is 25

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
    ];
    const result = splitEpisodes(lines, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0].lines).toHaveLength(2);
  });

  it('keeps lines in one episode when gap is exactly at threshold', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 25, 0); // exactly 25 min

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
    ];
    const result = splitEpisodes(lines, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0].lines).toHaveLength(2);
  });

  it('splits episodes when gap exceeds threshold', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 26, 0); // 26 min gap, threshold is 25

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
    ];
    const result = splitEpisodes(lines, defaultConfig);
    expect(result).toHaveLength(2);
    expect(result[0].lines).toEqual([lines[0]]);
    expect(result[1].lines).toEqual([lines[1]]);
  });

  it('respects configurable idle-gap threshold', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 10, 0); // 10 min gap

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
    ];

    const config5min: Config = { idleGapMinutes: 5 };
    const config15min: Config = { idleGapMinutes: 15 };

    const result5 = splitEpisodes(lines, config5min);
    const result15 = splitEpisodes(lines, config15min);

    expect(result5).toHaveLength(2); // 10 > 5, splits
    expect(result15).toHaveLength(1); // 10 < 15, stays together
  });

  it('creates multiple episodes in one day with correct boundaries', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 10, 0);
    const d3 = new Date(2026, 6, 15, 11, 0, 0); // 50 min gap, splits
    const d4 = new Date(2026, 6, 15, 11, 10, 0);
    const d5 = new Date(2026, 6, 15, 12, 0, 0); // 50 min gap, splits

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      createLine(3, 'user', d3.toISOString()),
      createLine(4, 'assistant', d4.toISOString()),
      createLine(5, 'user', d5.toISOString()),
    ];

    const result = splitEpisodes(lines, defaultConfig);
    expect(result).toHaveLength(3);
    expect(result[0].startLine).toBe(1);
    expect(result[0].endLine).toBe(2);
    expect(result[1].startLine).toBe(3);
    expect(result[1].endLine).toBe(4);
    expect(result[2].startLine).toBe(5);
    expect(result[2].endLine).toBe(5);
  });

  it('respects compaction boundary hook', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 1, 0); // only 1 min gap, no idle split
    const d3 = new Date(2026, 6, 15, 10, 2, 0);

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      createLine(3, 'user', d3.toISOString()),
    ];

    // No compaction hook
    const resultNoHook = splitEpisodes(lines, defaultConfig);
    expect(resultNoHook).toHaveLength(1);

    // Compaction after line 2 forces a split
    const resultWithHook = splitEpisodes(lines, defaultConfig, {
      compactionLineNumbers: new Set([2]),
    });
    expect(resultWithHook).toHaveLength(2);
    expect(resultWithHook[0].lines).toHaveLength(2);
    expect(resultWithHook[1].lines).toHaveLength(1);
  });

  it('returns episodes with correct line boundaries and no overlaps', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 10, 0);
    const d3 = new Date(2026, 6, 15, 11, 0, 0); // 50 min gap
    const d4 = new Date(2026, 6, 15, 11, 10, 0);

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      createLine(3, 'user', d3.toISOString()),
      createLine(4, 'assistant', d4.toISOString()),
    ];

    const result = splitEpisodes(lines, defaultConfig);
    expect(result).toHaveLength(2);

    // Reconstruct all lines from episodes
    const reconstructed = result.flatMap((ep) => ep.lines);
    expect(reconstructed).toEqual(lines);
    expect(reconstructed.map((l) => l.lineNumber)).toEqual([1, 2, 3, 4]);
  });

  it('splits an oversized episode into multiple token-budget-respecting pieces', () => {
    const base = new Date(2026, 6, 15, 10, 0, 0);
    // Each line's raw content is ~1000 chars (~250 tokens). 1000 lines
    // pushes one no-gap episode to ~250k estimated tokens, well over
    // MAX_EPISODE_TOKENS, forcing a split even though nothing here
    // triggers an idle-gap or compaction boundary.
    const bigContent = 'x'.repeat(1000);
    const lines: ParsedLine[] = [];
    for (let i = 1; i <= 1000; i++) {
      const ts = new Date(base.getTime() + i * 1000).toISOString();
      lines.push({
        lineNumber: i,
        type: 'user',
        timestamp: ts,
        hasToolUse: false,
        raw: { type: 'user', content: bigContent },
      });
    }

    const result = splitEpisodes(lines, defaultConfig);
    expect(result.length).toBeGreaterThan(1);

    // No data lost, no reordering, no overlap.
    const reconstructed = result.flatMap((ep) => ep.lines);
    expect(reconstructed).toEqual(lines);

    // Every piece fits under the token budget (or is an irreducible single line).
    for (const ep of result) {
      const estTokens = Math.ceil(JSON.stringify(ep.lines.map((l) => l.raw)).length / 4);
      expect(ep.lines.length === 1 || estTokens <= MAX_EPISODE_TOKENS).toBe(true);
    }
  });

  it('does not split a small episode that fits comfortably under the token budget', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 1, 0);
    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
    ];

    const result = splitEpisodes(lines, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0].lines).toEqual(lines);
  });
});

describe('detectCompactionBoundaries', () => {
  it('returns empty set when no line has isCompactSummary', () => {
    const lines = [
      createLine(1, 'user', '2026-07-15T10:00:00Z'),
      createLine(2, 'assistant', '2026-07-15T10:01:00Z'),
      createLine(3, 'user', '2026-07-15T10:02:00Z'),
    ];

    const boundaries = detectCompactionBoundaries(lines);
    expect(boundaries).toEqual(new Set());
  });

  it('marks the previous line number when a line has isCompactSummary=true', () => {
    const lines = [
      createLine(1, 'user', '2026-07-15T10:00:00Z'),
      createLine(2, 'assistant', '2026-07-15T10:01:00Z'),
      {
        lineNumber: 3,
        type: 'user' as const,
        timestamp: '2026-07-15T10:02:00Z',
        hasToolUse: false,
        raw: {
          type: 'user',
          isCompactSummary: true,
          message: { role: 'user', content: 'This session is being continued...' },
        },
      },
      createLine(4, 'user', '2026-07-15T10:03:00Z'),
    ];

    const boundaries = detectCompactionBoundaries(lines);
    expect(boundaries).toEqual(new Set([2]));
  });

  it('does not add boundary when compact-summary line is the first parsed line', () => {
    const lines = [
      {
        lineNumber: 1,
        type: 'user' as const,
        timestamp: '2026-07-15T10:00:00Z',
        hasToolUse: false,
        raw: {
          type: 'user',
          isCompactSummary: true,
          message: { role: 'user', content: 'This session is being continued...' },
        },
      },
      createLine(2, 'user', '2026-07-15T10:01:00Z'),
    ];

    const boundaries = detectCompactionBoundaries(lines);
    expect(boundaries).toEqual(new Set());
  });

  it('handles multiple compaction events in one session', () => {
    const lines = [
      createLine(1, 'user', '2026-07-15T10:00:00Z'),
      {
        lineNumber: 2,
        type: 'user' as const,
        timestamp: '2026-07-15T10:01:00Z',
        hasToolUse: false,
        raw: { type: 'user', isCompactSummary: true, message: { role: 'user', content: '...' } },
      },
      createLine(3, 'user', '2026-07-15T10:02:00Z'),
      {
        lineNumber: 4,
        type: 'user' as const,
        timestamp: '2026-07-15T10:03:00Z',
        hasToolUse: false,
        raw: { type: 'user', isCompactSummary: true, message: { role: 'user', content: '...' } },
      },
      createLine(5, 'user', '2026-07-15T10:04:00Z'),
    ];

    const boundaries = detectCompactionBoundaries(lines);
    expect(boundaries).toEqual(new Set([1, 3]));
  });

  it('ignores lines where isCompactSummary is absent, false, or non-boolean-truthy', () => {
    const lines = [
      createLine(1, 'user', '2026-07-15T10:00:00Z'),
      {
        lineNumber: 2,
        type: 'user' as const,
        timestamp: '2026-07-15T10:01:00Z',
        hasToolUse: false,
        raw: { type: 'user', isCompactSummary: false, content: '...' },
      },
      createLine(3, 'user', '2026-07-15T10:02:00Z'),
      {
        lineNumber: 4,
        type: 'user' as const,
        timestamp: '2026-07-15T10:03:00Z',
        hasToolUse: false,
        raw: { type: 'user', content: 'contains word compact' },
      },
      createLine(5, 'user', '2026-07-15T10:04:00Z'),
    ];

    const boundaries = detectCompactionBoundaries(lines);
    expect(boundaries).toEqual(new Set());
  });
});

describe('chunkSession', () => {
  it('integrates bucketByDay and splitEpisodes across multiple days', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0); // Day 1
    const d2 = new Date(2026, 6, 15, 10, 10, 0); // Day 1, same day
    const d3 = new Date(2026, 6, 16, 10, 0, 0); // Day 2
    const d4 = new Date(2026, 6, 16, 10, 10, 0); // Day 2
    const d5 = new Date(2026, 6, 16, 11, 0, 0); // Day 2, 50 min gap from d4, splits

    const lines = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      createLine(3, 'user', d3.toISOString()),
      createLine(4, 'assistant', d4.toISOString()),
      createLine(5, 'user', d5.toISOString()),
    ];

    const scanResult = {
      projectDir: '/test/project',
      sessionId: 'session-123',
      lines,
    };

    const result = chunkSession(scanResult, defaultConfig);

    // 1 episode on day 1, 2 episodes on day 2 (split by idle gap) = 3 total
    expect(result).toHaveLength(3);

    expect(result[0].date).toBe('2026-07-15');
    expect(result[0].startLine).toBe(1);
    expect(result[0].endLine).toBe(2);
    expect(result[0].lines).toHaveLength(2);

    expect(result[1].date).toBe('2026-07-16');
    expect(result[1].startLine).toBe(3);
    expect(result[1].endLine).toBe(4);
    expect(result[1].lines).toHaveLength(2);

    expect(result[2].date).toBe('2026-07-16');
    expect(result[2].startLine).toBe(5);
    expect(result[2].endLine).toBe(5);
    expect(result[2].lines).toHaveLength(1);

    // Verify all drafts carry metadata
    for (const draft of result) {
      expect(draft.projectDir).toBe('/test/project');
      expect(draft.sessionId).toBe('session-123');
    }

    // Verify reconstruction
    const allLines = result.flatMap((d) => d.lines);
    expect(allLines).toEqual(lines);
  });

  it('handles empty line list', () => {
    const scanResult = {
      projectDir: '/test/project',
      sessionId: 'session-123',
      lines: [],
    };

    const result = chunkSession(scanResult, defaultConfig);
    expect(result).toEqual([]);
  });

  it('automatically detects compaction boundaries and splits episodes', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 1, 0); // only 1 min gap, no idle split
    const d3 = new Date(2026, 6, 15, 10, 2, 0);
    const d4 = new Date(2026, 6, 15, 10, 3, 0);

    const lines: ParsedLine[] = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      {
        lineNumber: 3,
        type: 'user',
        timestamp: d3.toISOString(),
        hasToolUse: false,
        raw: {
          type: 'user',
          isCompactSummary: true,
          message: { role: 'user', content: 'This session is being continued...' },
        },
      },
      createLine(4, 'user', d4.toISOString()),
    ];

    const scanResult = {
      projectDir: '/test/project',
      sessionId: 'session-123',
      lines,
    };

    // Without detector, these 4 lines stay in one episode (no idle gap)
    // With detector wired in, the compaction at line 3 splits after line 2
    const result = chunkSession(scanResult, defaultConfig);
    expect(result).toHaveLength(2);
    expect(result[0].lines).toHaveLength(2);
    expect(result[0].startLine).toBe(1);
    expect(result[0].endLine).toBe(2);
    expect(result[1].lines).toHaveLength(2);
    expect(result[1].startLine).toBe(3);
    expect(result[1].endLine).toBe(4);
  });

  it('prefers explicit compactionLineNumbers over detected boundaries', () => {
    const d1 = new Date(2026, 6, 15, 10, 0, 0);
    const d2 = new Date(2026, 6, 15, 10, 1, 0);
    const d3 = new Date(2026, 6, 15, 10, 2, 0);
    const d4 = new Date(2026, 6, 15, 10, 3, 0);

    const lines: ParsedLine[] = [
      createLine(1, 'user', d1.toISOString()),
      createLine(2, 'assistant', d2.toISOString()),
      {
        lineNumber: 3,
        type: 'user',
        timestamp: d3.toISOString(),
        hasToolUse: false,
        raw: {
          type: 'user',
          isCompactSummary: true,
          message: { role: 'user', content: 'This session is being continued...' },
        },
      },
      createLine(4, 'user', d4.toISOString()),
    ];

    const scanResult = {
      projectDir: '/test/project',
      sessionId: 'session-123',
      lines,
    };

    // Explicit override: force split at line 1 instead of detected line 2
    const result = chunkSession(scanResult, defaultConfig, {
      compactionLineNumbers: new Set([1]),
    });

    expect(result).toHaveLength(2);
    expect(result[0].lines).toHaveLength(1);
    expect(result[0].startLine).toBe(1);
    expect(result[1].lines).toHaveLength(3);
    expect(result[1].startLine).toBe(2);
  });
});
