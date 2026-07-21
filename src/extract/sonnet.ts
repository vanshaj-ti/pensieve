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
           significance_score as significanceScore, effort_class as effortClass,
           verified_by_git as verifiedByGit,
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

function getSonnetSystemPrompt(recentHistoryDays: number): string {
  return `You are a verification and scoring system for development-session work items.

You receive:
1. Candidate work items extracted from today's sessions (indexed with episodeId, category, text, evidenceRef, evidenceSnippet)
2. Recent history of previously stored work items (from the last ${recentHistoryDays} days)`;
}

const SONNET_SYSTEM_PROMPT_TAIL = `

Note: exact-duplicate collapsing and cross-day recurrence linking already
happen downstream via embedding similarity — you do not need to solve those
yourself. Your job is the judgment calls embeddings can't make: rejecting
hallucinated/unsupported candidates, merging candidates that describe the
same underlying fact in different words (embeddings catch near-identical
text; you catch same-meaning-different-phrasing), and scoring significance
with real discrimination between levels. Note that "significance" here
measures impact/urgency of the work item, not whether it's a highlight-
worthy insight — a separate downstream synthesis pass decides what's worth
surfacing as an insight from the full set of scored work items you output.

Your task:
1. **Reject hallucinations**: For each candidate, verify that the evidenceSnippet actually supports the claimed work item. If it doesn't substantiate the claim, reject it.
2. **Merge same-meaning duplicates**: Identify candidates that describe the same underlying fact in different phrasing and merge them into one work item.
3. **Verify category fit**: The seven categories are architecture_decisions, exploration, mechanical_labor, bug_fix, ai_correction_load, friction_audit, high_potential_seeds (see below for the exact boundary between bug_fix and friction_audit, and between architecture_decisions and exploration). Re-categorize a candidate if Haiku mistagged it — do not just trust the incoming category.
   - architecture_decisions: a choice was made, with a stated reason. If no conclusion was reached, it's exploration instead.
   - exploration: research/investigation, whether or not it led anywhere.
   - mechanical_labor: implementation, testing, routine/known execution — including strong AI-assisted implementation and routine status narration ("tests passing", "build clean").
   - bug_fix: root cause diagnosed AND resolution applied — the fix itself.
   - friction_audit: the blocker/obstacle/symptom itself, NOT a code bug and NOT yet resolved (if it's a code bug with a stated fix, that's bug_fix instead).
   - ai_correction_load: AI-specific mistake the user caught/fixed.
   - high_potential_seeds: a deferred future idea, not yet acted on.
4. **Score significance using this rubric** (1-5, be discriminating — do not default to the middle):
   - 1 = cosmetic/trivial; no reader action implied.
   - 2 = minor; low impact, worth a footnote.
   - 3 = moderate; worth noting, not urgent, no immediate action needed.
   - 4 = significant; actionable, affects reliability/correctness/velocity.
   - 5 = critical; production bug, data loss, security issue, or a decision that changes the architecture.
5. **Polish text**: Refine the work item text to be clear, concise, and actionable.
6. **Classify effort**: Assign effortClass — orthogonal to category, answers
   "what kind of work produced this," not "what kind of thing is this."
   Every category can pair with any effort value, with no fixed mapping —
   including bug_fix, which is NOT locked to any single effort value:
   - toil: mechanical/repetitive work that shouldn't have needed a human
     more than once (e.g. the same manual workaround applied repeatedly
     because nobody fixed the root cause; a fix that "recurred" before
     being properly resolved).
   - judgment: real skilled reasoning or non-repeatable problem-solving
     (diagnosing an unfamiliar bug, weighing a real tradeoff, architecting
     a fix).
   - overhead: necessary but zero-signal cost — waiting, setup, tool
     friction, a regression that sat unnoticed for a while — neither toil
     nor judgment, just tax on the session.
   Two work items can share a category but differ here: a novel,
   hard-to-diagnose bug_fix requiring real investigation is judgment; the
   same known fix mechanically reapplied because the root cause was never
   addressed is bug_fix + toil; a bug that existed silently for a while
   before being noticed, where the cost is mostly drag rather than either
   diagnosis or repetition, is bug_fix + overhead.

Output every candidate as a scored, categorized work item with all fields
populated — do not omit routine or low-significance items, they still
matter for effort/category accounting even if they never surface as a
highlighted insight. recurrenceOf may be left null for every candidate —
the embedding-based recurrence pass downstream will set it independently;
do not spend effort guessing it from the pasted history.`;

export class SonnetVerificationError extends Error {
  constructor(
    public readonly batchSize: number,
    cause: unknown,
  ) {
    super(`Sonnet verify/score failed for a batch of ${batchSize} candidates`);
    this.cause = cause;
  }
}

export async function verifyAndScore(
  candidatesWithSource: CandidateWithSource[],
  recentHistory: Insight[],
  client: Anthropic,
  recentHistoryDays?: number,
): Promise<Insight[]> {
  try {
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

Process these candidates: reject hallucinations, merge near-duplicates, score significance (1-5), polish text, and flag recurrence against history.`;

    // See haiku.ts for why this must be called directly, not via a detached
    // function reference — casting the method strips its `this` binding.
    // historyList moved to cached system block so identical history across
    // batches in the same runExtraction call hits the cache (first batch pays
    // cache-write price; subsequent batches pay cache-read price instead of
    // full input-token price). Both system blocks are cache-controlled to
    // ensure consistent caching behavior across the entire call.
    const response = (await client.beta.promptCaching.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 16384,
      // NOTE: do NOT set `temperature` here — see src/extract/haiku.ts for
      // why (API rejects it with a 400 for this model/endpoint; a prior
      // attempt broke extraction entirely and was reverted).
      system: [
        {
          type: 'text',
          text: getSonnetSystemPrompt(recentHistoryDays ?? 7) + SONNET_SYSTEM_PROMPT_TAIL,
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: `Recent history (last ${recentHistoryDays ?? 7} days):\n${historyList}`,
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
                        'architecture_decisions',
                        'exploration',
                        'mechanical_labor',
                        'bug_fix',
                        'ai_correction_load',
                        'friction_audit',
                        'high_potential_seeds',
                      ],
                    },
                    text: { type: 'string' },
                    evidenceRef: { type: 'string' },
                    significanceScore: { type: 'number' },
                    effortClass: {
                      type: 'string',
                      enum: ['toil', 'judgment', 'overhead'],
                    },
                    recurrenceOf: { type: ['number', 'null'] },
                  },
                  required: [
                    'episodeId',
                    'category',
                    'text',
                    'evidenceRef',
                    'significanceScore',
                    'effortClass',
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
        effortClass: itemObj.effortClass as Insight['effortClass'],
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: new Date().toISOString(),
      };
      return InsightSchema.parse(insight);
    });
  } catch (error) {
    console.error(`Sonnet verify/score error for batch of ${candidatesWithSource.length}:`, error);
    throw new SonnetVerificationError(candidatesWithSource.length, error);
  }
}
