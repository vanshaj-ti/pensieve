import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { synthesizeBriefNarrative, deriveSessionInsights } from '../src/synthesis.js';
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

    const body = capturedArgs as { messages: Array<{ content: string }>; temperature?: number };
    expect(body.messages[0].content).toContain('A very specific friction point');
    expect(body.messages[0].content).toContain('100% toil');
    expect(body.temperature).toBeUndefined();
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

describe('deriveSessionInsights', () => {
  it('returns [] immediately when there are no work items, without calling the client', async () => {
    const create = vi.fn();
    const client = makeClient(create);

    const result = await deriveSessionInsights(
      { projectDir: '/proj', sessionId: 'sess', label: 'run-a', workItems: [] },
      client,
    );

    expect(result).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('parses derived insights from the emit_derived_insights tool_use block', async () => {
    const client = makeClient(async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_derived_insights',
          input: {
            insights: [
              {
                insightType: 'struggle',
                text: 'Recurring friction around token limits',
                evidenceInsightIds: [1, 2],
              },
              {
                insightType: 'idea',
                text: 'Worth exploring sqlite-vec',
                evidenceInsightIds: [3],
              },
            ],
          },
        },
      ],
    }));

    const result = await deriveSessionInsights(
      {
        projectDir: '/proj',
        sessionId: 'sess',
        label: 'run-a',
        workItems: [makeInsight({ id: 1 }), makeInsight({ id: 2 }), makeInsight({ id: 3 })],
      },
      client,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      projectDir: '/proj',
      sessionId: 'sess',
      label: 'run-a',
      insightType: 'struggle',
      text: 'Recurring friction around token limits',
      evidenceInsightIds: [1, 2],
    });
    expect(result[1].insightType).toBe('idea');
  });

  it('includes work item text and ids in the request body', async () => {
    let capturedArgs: unknown;
    const client = makeClient(async (...args: unknown[]) => {
      capturedArgs = args[0];
      return {
        content: [{ type: 'tool_use', name: 'emit_derived_insights', input: { insights: [] } }],
      };
    });

    await deriveSessionInsights(
      {
        projectDir: '/proj',
        sessionId: 'sess',
        label: 'run-a',
        workItems: [makeInsight({ id: 42, text: 'A very specific work item' })],
      },
      client,
    );

    const body = capturedArgs as { messages: Array<{ content: string }>; temperature?: number };
    expect(body.messages[0].content).toContain('A very specific work item');
    expect(body.messages[0].content).toContain('id=42');
    expect(body.temperature).toBeUndefined();
  });

  it('returns [] (no throw) when there is no tool_use block', async () => {
    const client = makeClient(async () => ({
      content: [{ type: 'text', text: 'not a tool call' }],
    }));

    const result = await deriveSessionInsights(
      { projectDir: '/proj', sessionId: 'sess', label: 'run-a', workItems: [makeInsight()] },
      client,
    );

    expect(result).toEqual([]);
  });

  it('returns [] (no throw) when the API call rejects', async () => {
    const client = makeClient(async () => {
      throw new Error('network error');
    });

    const result = await deriveSessionInsights(
      { projectDir: '/proj', sessionId: 'sess', label: 'run-a', workItems: [makeInsight()] },
      client,
    );

    expect(result).toEqual([]);
  });

  it('drops a derived insight whose evidenceInsightIds cites an id not present in workItems', async () => {
    const client = makeClient(async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_derived_insights',
          input: {
            insights: [
              {
                insightType: 'struggle',
                text: 'Grounded insight',
                evidenceInsightIds: [1],
              },
              {
                insightType: 'risk',
                text: 'Hallucinated insight',
                evidenceInsightIds: [999],
              },
            ],
          },
        },
      ],
    }));

    const result = await deriveSessionInsights(
      {
        projectDir: '/proj',
        sessionId: 'sess',
        label: 'run-a',
        workItems: [makeInsight({ id: 1 })],
      },
      client,
    );

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Grounded insight');
  });
});
