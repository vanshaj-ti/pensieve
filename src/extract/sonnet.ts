import Anthropic from '@anthropic-ai/sdk';
import type Database from 'better-sqlite3';
import { InsightSchema, type Insight, type Candidate } from '../types.js';

export interface CandidateWithSource {
  candidate: Candidate;
  episodeId: number;
}

export function getRecentInsights(db: Database.Database, days = 7): Insight[] {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const stmt = db.prepare(`
    SELECT id, episode_id as episodeId, category, text, evidence_ref as evidenceRef,
           significance_score as significanceScore, verified_by_git as verifiedByGit,
           recurrence_of as recurrenceOf, created_at as createdAt
    FROM insights
    WHERE created_at >= ?
    ORDER BY created_at DESC
  `);

  const rows = stmt.all(cutoffIso) as unknown[];

  return rows.map((row) => {
    const parsed = InsightSchema.parse(row);
    return parsed;
  });
}

const SONNET_SYSTEM_PROMPT = `You are a verification and scoring system for development insights.

You receive:
1. Candidate insights extracted from today's sessions (indexed with episodeId, category, text, evidenceRef, evidenceSnippet)
2. Recent history of previously stored insights (from the last 5-7 days)

Your task:
1. **Reject hallucinations**: For each candidate, verify that the evidenceSnippet actually supports the claimed insight. If it doesn't substantiate the claim, reject it.
2. **Merge duplicates**: Identify and merge near-duplicate candidates into single insights.
3. **Score significance**: Assign a significance score (1-5 scale, where 1 = trivial/peripheral, 5 = critical/transformative). Use this to prioritize insights in downstream processing.
4. **Polish text**: Refine the insight text to be clear, concise, and actionable.
5. **Flag recurrence**: Compare against recent history. If today's insight closely matches a previous insight, set recurrenceOf to that insight's id. Otherwise set it to null.

Output only approved insights with all fields populated.`;

export async function verifyAndScore(
  candidatesWithSource: CandidateWithSource[],
  recentHistory: Insight[],
  client: Anthropic,
): Promise<Insight[]> {
  const candidatesList = candidatesWithSource
    .map(
      (cws, idx) => `
[Candidate ${idx}]
Episode ID: ${cws.episodeId}
Category: ${cws.candidate.category}
Text: ${cws.candidate.text}
Evidence (${cws.candidate.evidenceRef}): "${cws.candidate.evidenceSnippet}"
`,
    )
    .join('\n');

  const historyList =
    recentHistory.length > 0
      ? recentHistory
          .map(
            (insight) => `
- ID ${insight.id}: [${insight.category}] ${insight.text} (created: ${insight.createdAt})
`,
          )
          .join('\n')
      : '(No recent history)';

  const userMessage = `Today's candidates:
${candidatesList}

Recent history (last 5-7 days):
${historyList}

Process these candidates: reject hallucinations, merge near-duplicates, score significance (1-5), polish text, and flag recurrence against history.`;

  // See haiku.ts for why this must be called directly, not via a detached
  // function reference — casting the method strips its `this` binding.
  const response = (await client.beta.promptCaching.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 16384,
    system: [
      {
        type: 'text',
        text: SONNET_SYSTEM_PROMPT,
      },
    ],
    tools: [
      {
        name: 'emit_insights',
        description: 'Emit verified, scored, and deduplicated insights',
        input_schema: {
          type: 'object' as const,
          properties: {
            insights: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  episodeId: { type: 'number' },
                  category: {
                    type: 'string',
                    enum: [
                      'strategic_value',
                      'decision_record',
                      'friction_audit',
                      'high_potential_seeds',
                      'ai_leverage',
                      'ai_correction_load',
                    ],
                  },
                  text: { type: 'string' },
                  evidenceRef: { type: 'string' },
                  significanceScore: { type: 'number' },
                  recurrenceOf: { type: ['number', 'null'] },
                },
                required: ['episodeId', 'category', 'text', 'evidenceRef', 'significanceScore', 'recurrenceOf'],
              },
            },
          },
          required: ['insights'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_insights' },
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  } as any)) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolUse = (response as any).content.find((block: any) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('No tool_use block in Sonnet response');
  }

  if (toolUse.name !== 'emit_insights') {
    throw new Error(`Expected tool_use named emit_insights, got ${toolUse.name}`);
  }

  if (typeof toolUse.input !== 'object' || toolUse.input === null || !('insights' in toolUse.input)) {
    throw new Error(
      `Tool input missing insights field (stop_reason: ${(response as any).stop_reason}) — ` +
        'likely truncated by max_tokens if stop_reason is "max_tokens"',
    );
  }

  const insights = toolUse.input.insights;
  if (!Array.isArray(insights)) {
    throw new Error(`Tool input insights must be an array, got ${typeof insights}`);
  }

  return insights.map((item: unknown) => {
    const itemObj = item as Record<string, unknown>;
    const insight: Insight = {
      episodeId: itemObj.episodeId as number,
      category: itemObj.category as Insight['category'],
      text: itemObj.text as string,
      evidenceRef: itemObj.evidenceRef as string,
      significanceScore: itemObj.significanceScore as number,
      verifiedByGit: null,
      recurrenceOf: (itemObj.recurrenceOf as number | null) ?? null,
      createdAt: new Date().toISOString(),
    };
    return InsightSchema.parse(insight);
  });
}
