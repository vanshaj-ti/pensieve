import Anthropic from '@anthropic-ai/sdk';
import type { Insight } from './types.js';
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
