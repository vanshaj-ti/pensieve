import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { synthesizeBriefNarrative } from '../src/synthesis.js';
import type { Insight } from '../src/types.js';
import type { EffortBreakdown } from '../src/analytics/index.js';

function makeClient(createImpl: (...args: unknown[]) => unknown): Anthropic {
  return {
    beta: {
      promptCaching: {
        messages: {
          create: vi.fn(createImpl),
        },
      },
    },
  } as unknown as Anthropic;
}

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    episodeId: 1,
    category: 'friction_audit',
    text: 'Something broke',
    evidenceRef: 'line:1',
    significanceScore: 4,
    effortClass: 'toil',
    verifiedByGit: null,
    recurrenceOf: null,
    createdAt: '2026-07-15T10:00:00Z',
    ...overrides,
  };
}

const emptyBreakdown: EffortBreakdown = {
  toil: 0,
  judgment: 0,
  overhead: 0,
  total: 0,
  toilRatio: 0,
  judgmentRatio: 0,
  overheadRatio: 0,
};

describe('synthesizeBriefNarrative', () => {
  it('returns null immediately when there are no insights, without calling the client', async () => {
    const create = vi.fn();
    const client = makeClient(create);

    const result = await synthesizeBriefNarrative(
      { insights: [], effortBreakdown: emptyBreakdown, date: '2026-07-15' },
      client,
    );

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns the trimmed text block on a successful response', async () => {
    const client = makeClient(async () => ({
      content: [{ type: 'text', text: '  Today was mostly debugging.  ' }],
    }));

    const result = await synthesizeBriefNarrative(
      {
        insights: [makeInsight()],
        effortBreakdown: { ...emptyBreakdown, total: 1, toil: 1, toilRatio: 1 },
        date: '2026-07-15',
      },
      client,
    );

    expect(result).toBe('Today was mostly debugging.');
  });

  it('includes insight text and effort ratios in the request body', async () => {
    let capturedArgs: unknown;
    const client = makeClient(async (...args: unknown[]) => {
      capturedArgs = args[0];
      return { content: [{ type: 'text', text: 'summary' }] };
    });

    await synthesizeBriefNarrative(
      {
        insights: [makeInsight({ text: 'A very specific friction point' })],
        effortBreakdown: { ...emptyBreakdown, total: 1, toil: 1, toilRatio: 1 },
        date: '2026-07-15',
      },
      client,
    );

    const body = capturedArgs as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toContain('A very specific friction point');
    expect(body.messages[0].content).toContain('100% toil');
  });

  it('returns null (no throw) when the response has no text block', async () => {
    const client = makeClient(async () => ({
      content: [{ type: 'tool_use', name: 'something_else' }],
    }));

    const result = await synthesizeBriefNarrative(
      { insights: [makeInsight()], effortBreakdown: emptyBreakdown, date: '2026-07-15' },
      client,
    );

    expect(result).toBeNull();
  });

  it('returns null (no throw) when the API call rejects', async () => {
    const client = makeClient(async () => {
      throw new Error('network error');
    });

    const result = await synthesizeBriefNarrative(
      { insights: [makeInsight()], effortBreakdown: emptyBreakdown, date: '2026-07-15' },
      client,
    );

    expect(result).toBeNull();
  });

  it('returns null when the text block is empty/whitespace-only', async () => {
    const client = makeClient(async () => ({
      content: [{ type: 'text', text: '   ' }],
    }));

    const result = await synthesizeBriefNarrative(
      { insights: [makeInsight()], effortBreakdown: emptyBreakdown, date: '2026-07-15' },
      client,
    );

    expect(result).toBeNull();
  });
});
