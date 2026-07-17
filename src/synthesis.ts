import Anthropic from '@anthropic-ai/sdk';
import { DerivedInsightSchema, type DerivedInsight, type Insight } from './types.js';
import type { EffortBreakdown } from './analytics/index.js';

const SYNTHESIS_SYSTEM_PROMPT = `You write a one-paragraph narrative summary at the top of a daily development insight brief.

You receive today's insights (grouped by category, with significance scores and effort classifications) and an effort breakdown (toil/judgment/overhead ratios).

Write ONE short paragraph (3-5 sentences, no bullet points, no headers) that:
1. Names today's dominant theme in one clause (what was this day mostly about — e.g. "today was a debugging day," "today was mostly architectural decision-making").
2. Names the single biggest friction point, if one clearly stands out (highest-significance friction_audit or ai_correction_load insight).
3. Names one concrete thing worth fixing or following up on, if the insights suggest one (a high-potential_seed, or a toil pattern that recurred).
4. If effort breakdown shows toil > 30%, mention it explicitly (e.g. "a notable share of today was mechanical toil rather than judgment work").

Be concrete and specific — reference actual insight content, not generic filler like "productive day" or "made good progress." If the day's insights don't clearly support one of points 2-4, omit that point rather than inventing something. Output plain prose only, no markdown formatting, no preamble like "Here is the summary:".`;

export interface SynthesisInput {
  insights: Insight[];
  effortBreakdown: EffortBreakdown;
  date: string;
}

/**
 * Returns null (never throws) if there's nothing to synthesize (no
 * insights) or if the API call fails — the brief renders fine without a
 * narrative paragraph, this is additive polish, not load-bearing.
 */
export async function synthesizeBriefNarrative(
  input: SynthesisInput,
  client?: Anthropic,
): Promise<string | null> {
  if (input.insights.length === 0) {
    return null;
  }

  const anthropicClient =
    client ??
    new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com',
    });

  const insightsList = input.insights
    .map(
      (insight) =>
        `[${insight.category}, significance=${insight.significanceScore}, effort=${insight.effortClass}] ${insight.text}`,
    )
    .join('\n');

  const userMessage = `Date: ${input.date}

Today's insights:
${insightsList}

Effort breakdown: ${Math.round(input.effortBreakdown.judgmentRatio * 100)}% judgment, ${Math.round(input.effortBreakdown.toilRatio * 100)}% toil, ${Math.round(input.effortBreakdown.overheadRatio * 100)}% overhead (${input.effortBreakdown.total} insights).

Write the one-paragraph narrative summary now.`;

  try {
    // See src/extract/haiku.ts for why this must be called directly, not
    // via a detached function reference — casting the method strips its
    // `this` binding.
    const response = await anthropicClient.beta.promptCaching.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      // NOTE: do NOT set `temperature` here — see src/extract/haiku.ts.
      system: [
        {
          type: 'text',
          text: SYNTHESIS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlock = (response as any).content.find((block: any) => block.type === 'text');
    if (!textBlock || typeof textBlock.text !== 'string' || textBlock.text.trim() === '') {
      console.error('Synthesis: no text block in response, skipping narrative paragraph');
      return null;
    }

    return textBlock.text.trim();
  } catch (err) {
    console.error(
      'Synthesis: API call failed, skipping narrative paragraph:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

const DERIVE_INSIGHTS_SYSTEM_PROMPT = `You derive higher-level insights from a session's full set of tagged work items. A work item is a raw tagged record (category + effort + evidence + significance); a derived insight is a genuine conclusion — not a restatement of one work item, but a pattern or takeaway synthesized across several, or a single work item significant enough to stand on its own.

You receive every work item for one session (category, effortClass, significanceScore, text, and a numeric id).

Produce 0-N derived insights, each with exactly one insightType:
- struggle: What is the person doing wrong, or where are they stuck? Look for recurring friction_audit/bug_fix/ai_correction_load items, especially clustered around the same root cause.
- win: What is the person doing right? Look for architecture_decisions with sound reasoning, efficient judgment-heavy work, or low ai_correction_load relative to AI-assisted work.
- learning: What did the person learn? Look for exploration or architecture_decisions items that produced a real conclusion or changed understanding.
- idea: What's worth exploring? Pull forward the most valuable high_potential_seeds item(s) — combine related seeds into one derived insight if they point at the same underlying opportunity. This is not just copying a seed verbatim; add the "why this matters now" framing if the work items support it.
- risk: What unaddressed problem is building up? Look for a toil pattern that recurred without the root cause being fixed, or a friction/bug cluster that keeps costing time without resolution.

Rules:
- Do not invent a derived insight if the work items don't support it — it is correct and expected to return fewer than 5, or even zero, if the session's work items are too sparse or too routine (e.g. almost entirely mechanical_labor with no clusters or notable items).
- Every derived insight must cite the specific work-item ids it is grounded in (evidenceInsightIds) — never fabricate an id that wasn't provided.
- Be concrete: reference actual work-item content, not generic filler like "good progress was made."
- A single highly significant work item (significanceScore 5) can justify its own derived insight without needing a cluster — but low-significance items should only become a derived insight if there's a real pattern across several of them.`;

export interface DeriveInsightsInput {
  projectDir: string;
  sessionId: string;
  label: string;
  workItems: Insight[];
}

/**
 * Generates derived insights (struggle/win/learning/idea/risk) from one
 * session's full set of work items. Unlike synthesizeBriefNarrative, this
 * is NOT automatic per-day — it's triggered on-demand per session/run from
 * the dashboard. Never throws; returns [] on any failure (additive, not
 * load-bearing for the pipeline).
 */
export async function deriveSessionInsights(
  input: DeriveInsightsInput,
  client?: Anthropic,
): Promise<DerivedInsight[]> {
  if (input.workItems.length === 0) {
    return [];
  }

  const anthropicClient =
    client ??
    new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com',
    });

  const workItemsList = input.workItems
    .map(
      (item) =>
        `[id=${item.id}, category=${item.category}, effort=${item.effortClass}, significance=${item.significanceScore}] ${item.text}`,
    )
    .join('\n');

  const userMessage = `Session: ${input.projectDir} / ${input.sessionId} (run: ${input.label})

Work items:
${workItemsList}

Derive 0-N insights from these work items now.`;

  try {
    // See src/extract/haiku.ts for why this must be called directly, not
    // via a detached function reference — casting the method strips its
    // `this` binding.
    const response = await anthropicClient.beta.promptCaching.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      // NOTE: do NOT set `temperature` here — see src/extract/haiku.ts.
      system: [
        {
          type: 'text',
          text: DERIVE_INSIGHTS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: 'emit_derived_insights',
          description: 'Emit derived insights synthesized from the session work items',
          input_schema: {
            type: 'object' as const,
            properties: {
              insights: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    insightType: {
                      type: 'string',
                      enum: ['struggle', 'win', 'learning', 'idea', 'risk'],
                    },
                    text: { type: 'string' },
                    evidenceInsightIds: {
                      type: 'array',
                      items: { type: 'number' },
                    },
                  },
                  required: ['insightType', 'text', 'evidenceInsightIds'],
                },
              },
            },
            required: ['insights'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_derived_insights' },
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = (response as any).content.find((block: any) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== 'emit_derived_insights') {
      console.error('Derive insights: no emit_derived_insights tool_use block in response');
      return [];
    }

    const rawInsights = toolUse.input?.insights;
    if (!Array.isArray(rawInsights)) {
      console.error('Derive insights: tool input insights must be an array');
      return [];
    }

    const createdAt = new Date().toISOString();
    return rawInsights.map((item: unknown) => {
      const itemObj = item as Record<string, unknown>;
      const derived: DerivedInsight = {
        projectDir: input.projectDir,
        sessionId: input.sessionId,
        label: input.label,
        insightType: itemObj.insightType as DerivedInsight['insightType'],
        text: itemObj.text as string,
        evidenceInsightIds: (itemObj.evidenceInsightIds as number[]) ?? [],
        createdAt,
      };
      return DerivedInsightSchema.parse(derived);
    });
  } catch (err) {
    console.error(
      'Derive insights: API call failed:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
