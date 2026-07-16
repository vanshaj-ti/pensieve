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

Note: exact-duplicate collapsing and cross-day recurrence linking already
happen downstream via embedding similarity — you do not need to solve those
yourself. Your job is the judgment calls embeddings can't make: rejecting
hallucinated/unsupported candidates, merging candidates that describe the
same underlying fact in different words (embeddings catch near-identical
text; you catch same-meaning-different-phrasing), and scoring significance
with real discrimination between levels.

Your task:
1. **Hard-exclude status/progress noise.** A candidate that merely reports
   an event happened — "session completed successfully", "N tests passing",
   "run X finished", "PR merged" — is NOT an insight, even if it mentions
   architecture, decisions, or strategy in passing. An insight has to say
   something that changes what the reader would do or believe next time;
   a status update does not. Reject these outright, do not lower their
   score — they should not appear in the output at all.
   - Negative example (REJECT): "Pensieve scaffold (run 1) completed and
     approved: TS project setup, SQLite schema, 12 passing tests, clean
     lint/build." — this is a log line, not an insight.
   - Positive example (KEEP): "Two-pass extraction architecture locked:
     Haiku does cheap high-recall candidate generation; Sonnet verifies
     once daily in batch." — this is a decision with a stated rationale,
     not a status report.
2. **Reject hallucinations**: For each candidate, verify that the evidenceSnippet actually supports the claimed insight. If it doesn't substantiate the claim, reject it.
3. **Merge same-meaning duplicates**: Identify candidates that describe the same underlying fact in different phrasing and merge them into one insight.
4. **Score significance using this rubric** (1-5, be discriminating — do not default to the middle):
   - 1 = cosmetic/trivial; no reader action implied.
   - 2 = minor; low impact, worth a footnote.
   - 3 = moderate; worth noting, not urgent, no immediate action needed.
   - 4 = significant; actionable, affects reliability/correctness/velocity.
   - 5 = critical; production bug, data loss, security issue, or a decision that changes the architecture.
5. **Polish text**: Refine the insight text to be clear, concise, and actionable.

Output only approved insights with all fields populated. recurrenceOf may be left null for every candidate — the embedding-based recurrence pass downstream will set it independently; do not spend effort guessing it from the pasted history.`;

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
        cache_control: { type: 'ephemeral' },
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
                required: [
                  'episodeId',
                  'category',
                  'text',
                  'evidenceRef',
                  'significanceScore',
                  'recurrenceOf',
                ],
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

  if (
    typeof toolUse.input !== 'object' ||
    toolUse.input === null ||
    !('insights' in toolUse.input)
  ) {
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
