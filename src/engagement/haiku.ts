import Anthropic from '@anthropic-ai/sdk';
import { EngagementCandidateSchema, type EngagementCandidate } from '../types.js';
import type { EpisodeDraft } from '../chunk/episodes.js';
import { isAcknowledgment, looksLikeDirectiveHint, type TurnPair } from './turns.js';

export class EngagementClassificationError extends Error {
  constructor(
    public readonly episode: Pick<
      EpisodeDraft,
      'projectDir' | 'sessionId' | 'startLine' | 'endLine'
    >,
    cause: unknown,
  ) {
    super(
      `Engagement classification failed for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}`,
    );
    this.cause = cause;
  }
}

const SYSTEM_PROMPT = `You are classifying human turns in a development session transcript against the agent turn that immediately preceded each one. The question is NOT what work happened — it's what the human's turn itself contributed: babysitting the agent, or engaging well with it.

Classify each human turn into exactly one of four categories:
- directive: The human tells the agent HOW and WHAT to do, step by step ("run the tests", "now edit file X", "add a null check there", "use --force") — imperative micromanagement of procedure the agent could have decided itself. Also applies when the human manually performs a step (pastes command output, writes the actual code/fix) instead of letting the agent do it, when the agent already had the tools/access to do it. This is the babysitting category.
- deliberative: The human reasons, discusses tradeoffs, makes a decision, answers a genuine question the agent asked, provides domain/business context the agent could not have derived on its own, or directs research ("look into whether X approach works"). This is good engagement — human judgment, not procedure.
- corrective: The human catches a real mistake the agent made and points it out. Good that it was caught, but it's a cost signal (agent quality problem), not a virtue to repeat.
- acknowledgment: Low-content "yes"/"continue"/"lgtm"/"looks good" with no new information. Neither babysitting nor engagement — pure noise, exclude from analysis.

Key disambiguation: the SAME sentence can be directive or deliberative depending on context. "Use approach B" is deliberative if the agent had just asked "should I use A or B?" (the human is resolving a real ambiguity by choosing). "Use approach B" is directive if the agent never asked and was already investigating on its own — the human is pre-empting the agent's own reasoning process with an order.

For "directive" classifications only, also decide directiveNecessary:
- true: the directive was a necessary gate — the agent was genuinely blocked (no tool access, needed a real decision only a human could make), or the action under discussion is irreversible/high-risk (deploy, force-push, merge to main, delete data, drop a table, production config change) where a human checkpoint is correct behavior, not babysitting.
- false: the human gave an imperative instruction for something the agent already had the ability and permission to figure out or do itself — pure habit/distrust, not a necessary gate.
Leave directiveNecessary null for every other classification.

For every turn, provide a one-line "reason" naming specifically what this reveals — e.g. "ran tests manually; agent already had shell access" or "answered agent's design question with a concrete tradeoff" — concrete enough to be actionable, not just "was directive."

You will be given hints for each turn: whether the preceding agent turn asked a question, whether the agent had tool access, and a cheap heuristic guess (agentHadToolAccess, agentAskedQuestion, likelyDirective) — treat these as hints only, not ground truth; classify based on the actual text.`;

interface ClassifyOutput {
  candidates: EngagementCandidate[];
}

/** Below this, a turn-pair batch is too small to usefully re-split further —
 * stop bisecting and let the error surface, mirroring extract/haiku.ts's
 * MIN_SPLIT_LINES pattern for the same truncation-recovery reason. */
const MIN_SPLIT_PAIRS = 4;

export async function classifyTurns(
  episode: EpisodeDraft,
  pairs: TurnPair[],
  client: Anthropic,
): Promise<EngagementCandidate[]> {
  // Stage 0: filter acknowledgments before any LLM call — never reaches
  // Haiku, never scored.
  const candidates: EngagementCandidate[] = [];
  const toClassify: TurnPair[] = [];
  for (const pair of pairs) {
    if (isAcknowledgment(pair.humanTurnText)) {
      candidates.push({
        humanLineNumber: pair.humanLineNumber,
        classification: 'acknowledgment',
        directiveNecessary: null,
        reason: 'low-content acknowledgment, filtered before classification',
      });
    } else {
      toClassify.push(pair);
    }
  }

  if (toClassify.length === 0) {
    return candidates;
  }

  try {
    const classified = await classifyTurnsForPairs(episode, toClassify, client);
    return [...candidates, ...classified];
  } catch (error) {
    console.error(
      `Engagement classification error for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}:`,
      error,
    );
    throw new EngagementClassificationError(episode, error);
  }
}

async function classifyTurnsForPairs(
  episode: EpisodeDraft,
  pairs: TurnPair[],
  client: Anthropic,
): Promise<EngagementCandidate[]> {
  try {
    const userMessage = `Episode from ${episode.date} (${episode.projectDir}/${episode.sessionId}):\n\n${pairs
      .map(
        (p, i) =>
          `--- Turn ${i + 1} (human line ${p.humanLineNumber}) ---\n` +
          `[Preceding agent turn] (agentAskedQuestion: ${p.agentAskedQuestion}, agentHadToolAccess: ${p.agentHadToolAccess}): ${p.agentTurnText}\n` +
          `[Human turn] (likelyDirective: ${looksLikeDirectiveHint(p.humanTurnText)}): ${p.humanTurnText}`,
      )
      .join('\n\n')}`;

    // NOTE: calling client.beta.promptCaching.messages.create directly (not
    // via a detached function reference) is required — see
    // extract/haiku.ts's identical note; `this` binding breaks otherwise.
    const response = (await client.beta.promptCaching.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      temperature: 0,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: 'emit_engagement_classifications',
          description: 'Emit engagement classification for each human turn',
          input_schema: {
            type: 'object' as const,
            properties: {
              candidates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    humanLineNumber: { type: 'number' },
                    classification: {
                      type: 'string',
                      enum: ['directive', 'deliberative', 'corrective', 'acknowledgment'],
                    },
                    directiveNecessary: { type: ['boolean', 'null'] },
                    reason: { type: 'string' },
                  },
                  required: ['humanLineNumber', 'classification', 'directiveNecessary', 'reason'],
                },
              },
            },
            required: ['candidates'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_engagement_classifications' },
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
      throw new Error('No tool_use block in response');
    }

    if (toolUse.name !== 'emit_engagement_classifications') {
      throw new Error(
        `Expected tool_use named emit_engagement_classifications, got ${toolUse.name}`,
      );
    }

    if (
      typeof toolUse.input !== 'object' ||
      toolUse.input === null ||
      !('candidates' in toolUse.input)
    ) {
      // Mirrors extract/haiku.ts's truncation-recovery: a large batch of
      // turn pairs can exceed max_tokens, truncating the tool_use JSON
      // mid-array. Bisect and retry both halves rather than silently
      // dropping the whole batch's classifications.
      if ((response as any).stop_reason === 'max_tokens' && pairs.length > MIN_SPLIT_PAIRS) {
        const mid = Math.floor(pairs.length / 2);
        const [first, second] = await Promise.all([
          classifyTurnsForPairs(episode, pairs.slice(0, mid), client),
          classifyTurnsForPairs(episode, pairs.slice(mid), client),
        ]);
        return [...first, ...second];
      }
      throw new Error(
        `Tool input missing candidates field (stop_reason: ${(response as any).stop_reason}) — ` +
          'likely truncated by max_tokens if stop_reason is "max_tokens"',
      );
    }

    const raw = (toolUse.input as ClassifyOutput).candidates;
    if (!Array.isArray(raw)) {
      throw new Error(`Tool input candidates must be an array, got ${typeof raw}`);
    }

    // safeParse per item, not .map(EngagementCandidateSchema.parse) — same
    // fix applied to extract/haiku.ts after a real production bug: one
    // malformed item must not discard every other valid classification in
    // the same response.
    const parsed: EngagementCandidate[] = [];
    for (const item of raw) {
      const result = EngagementCandidateSchema.safeParse(item);
      if (result.success) {
        parsed.push(result.data);
      } else {
        console.error(
          `Skipping malformed engagement candidate for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}:`,
          result.error.message,
        );
      }
    }
    return parsed;
  } catch (error) {
    console.error(
      `Engagement classification error for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}:`,
      error,
    );
    throw new EngagementClassificationError(episode, error);
  }
}
