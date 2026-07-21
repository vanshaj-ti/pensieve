import Anthropic from '@anthropic-ai/sdk';
import { CandidateSchema, type Candidate } from '../types.js';
import type { EpisodeDraft } from '../chunk/episodes.js';
import type { ParsedLine } from '../ingest/parser.js';

export class HaikuExtractionError extends Error {
  constructor(
    public readonly episode: Pick<
      EpisodeDraft,
      'projectDir' | 'sessionId' | 'startLine' | 'endLine'
    >,
    cause: unknown,
  ) {
    super(
      `Haiku candidate generation failed for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}`,
    );
    this.cause = cause;
  }
}

const SYSTEM_PROMPT = `You are a work-item extraction system. Your task is to tag every distinct unit of work in a development session transcript into one of seven categories. A work item is NOT necessarily a "learning" or "insight" — it's a raw tagged record of something that happened. A separate downstream synthesis pass decides what's actually worth surfacing as an insight; your job is complete, high-recall tagging.

Extract work items into one of these seven categories:
- architecture_decisions: An architecture/product choice was made, with a stated reason ("we chose X over Y because Z") or a clear alternative considered. Example: "Chose Claude Haiku for episode extraction and Claude Sonnet for verification over a local-only LLM approach, since local 8B models still lag Haiku-tier on nuanced categorization and API cost is negligible at daily scale."
- exploration: Research or investigation of an approach — whether or not it led to a decision or concrete outcome. Example: "Explored whether Vite+React vs staying vanilla was worth it for the dashboard, read existing patterns, weighed the tradeoff."
- mechanical_labor: Implementation, testing, or routine/known execution — no new judgment required. Includes AI doing solid implementation work (not a separate category) AND pure status/progress narration ("tests passing", "build clean", "PR merged", "ran the build"). Example: "Ran the build command, restarted the dashboard server, and re-verified the same drill-down flow in the browser after each of three consecutive small CSS fixes."
- bug_fix: A root cause was diagnosed AND a resolution was applied. This is the fix itself — not the symptom (see friction_audit). Example: "First dedup clustering implementation had a real bug: reassigning the survivor index mid-cluster left the new survivor unmarked, causing double-counting. Rewrote as single-pass visited-set clustering to fix it."
- ai_correction_load: The user corrected AI output, re-ran something because the AI got it wrong, or caught an AI mistake. Must be AI-specific, not general human error. Example: "First dedup clustering implementation had a bug the user caught and had rewritten as single-pass visited-set clustering."
- friction_audit: A blocker, error, or time-wasting obstacle that is NOT a code bug — slow CI, a confusing tool error, an unclear API, a process breakdown. The symptom/incident itself, not its resolution. Example: "Episode chunking allowed single episodes to exceed Haiku's 200k token context limit (observed 253,935 tokens) with no retry or truncation fallback, causing silent data loss."
- high_potential_seeds: A future-tense or speculative idea the user expressed but has not yet acted on — "what if we...", "we could later...". Not something already built. Example: "A weekly/monthly friction rollup ('this issue recurred 12 times this month') would be a much stronger signal than the current 30-day recurrence-chain view, which has no long-horizon aggregation yet."

To disambiguate categories that are easy to confuse:

1. bug_fix vs friction_audit: A bug_fix requires both a diagnosed root cause AND an applied resolution. A friction_audit is the unresolved symptom/blocker itself. Example pair: bug_fix = "Dedup clustering had a bug where reassigning the survivor index mid-cluster left the new survivor unmarked, causing double-counting. Rewrote as single-pass visited-set clustering." vs friction_audit = "Episode chunking allows single episodes to exceed Haiku's 200k token context limit (observed 253,935 tokens) with no truncation fallback, causing silent data loss." Distinction: The first diagnoses cause AND applied a fix; the second describes an unresolved blocker.

2. architecture_decisions vs exploration: architecture_decisions requires a stated choice that was committed to. exploration is investigation that may or may not lead to a decision. Example pair: architecture_decisions = "Decided to use Claude Haiku for episode extraction over local models, since Haiku outperforms 8B models on nuanced categorization and API cost is negligible at daily scale." vs exploration = "Explored whether Vite+React was worth it for the dashboard over staying vanilla, read existing patterns, weighed the tradeoff." Distinction: The first makes a committed choice with reasoning; the second investigates tradeoffs without concluding in a decision.

3. ai_correction_load vs bug_fix: ai_correction_load requires the mistake to be AI's own output being corrected. bug_fix is about the defect and fix regardless of origin. Example pair: ai_correction_load = "Claude suggested a dedup approach with a subtle flaw; the user caught the double-counting issue and had Claude rewrite it as single-pass visited-set clustering." vs bug_fix = "Found a dedup bug during code review where reassigning the survivor index left the new survivor unmarked, causing double-counting. Fixed with single-pass visited-set clustering." Distinction: The first is AI output corrected by the user; the second is a defect diagnosed and fixed with no AI-authorship angle.

Be high-recall: over-include candidates rather than being conservative, including routine/mechanical work — tag it mechanical_labor rather than omitting it. False positives are filtered in downstream verification; false negatives are permanent misses. There is no "exclude entirely" category anymore — every distinct unit of work gets tagged into one of the seven categories above, even if it's routine status narration (tag as mechanical_labor).

For each work item, provide:
- category: One of the seven categories above
- text: The work item text (will be polished downstream)
- evidenceRef: Format "line:<lineNumber>" pointing to supporting evidence
- evidenceSnippet: Exact quoted substring from the episode supporting the claim`;

interface RenderedLine {
  lineNumber: number;
  type: string;
  content: string;
}

function renderLines(lines: ParsedLine[]): RenderedLine[] {
  return lines.map((line) => {
    let content = '';
    const rawObj = line.raw as Record<string, unknown> | null;

    if (rawObj && 'message' in rawObj) {
      const message = rawObj.message as Record<string, unknown> | null;
      if (message && 'content' in message) {
        if (typeof message.content === 'string') {
          content = message.content;
        } else if (Array.isArray(message.content)) {
          const textParts: string[] = [];
          for (const block of message.content) {
            if (typeof block === 'object' && block !== null) {
              if ('type' in block && block.type === 'text' && 'text' in block) {
                textParts.push(String(block.text));
              } else if (
                'type' in block &&
                block.type === 'tool_use' &&
                'name' in block &&
                'input' in block
              ) {
                textParts.push(`[tool_use: ${String(block.name)}] ${JSON.stringify(block.input)}`);
              } else if ('type' in block && block.type === 'tool_result' && 'content' in block) {
                const trContent = block.content;
                let trText = '';
                if (typeof trContent === 'string') {
                  trText = trContent;
                } else if (Array.isArray(trContent)) {
                  const trParts: string[] = [];
                  for (const item of trContent) {
                    if (
                      typeof item === 'object' &&
                      item !== null &&
                      'type' in item &&
                      item.type === 'text' &&
                      'text' in item
                    ) {
                      trParts.push(String(item.text));
                    }
                  }
                  trText = trParts.join(' ');
                }
                if (trText) {
                  textParts.push(`[tool_result] ${trText}`);
                }
              }
            }
          }
          content = textParts.join('\n');
        }
      }
    }

    return {
      lineNumber: line.lineNumber,
      type: line.type,
      content,
    };
  });
}

/** Below this, an episode half is too small to usefully re-split further —
 * stop bisecting and let the error surface (matches the pre-existing
 * skip-episode behavior for a genuinely irreducible failure). */
const MIN_SPLIT_LINES = 20;

export async function generateCandidates(
  episode: EpisodeDraft,
  client: Anthropic,
): Promise<Candidate[]> {
  try {
    return await generateCandidatesForLines(episode, episode.lines, client);
  } catch (error) {
    console.error(
      `Haiku extraction error for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}:`,
      error,
    );
    throw new HaikuExtractionError(episode, error);
  }
}

async function generateCandidatesForLines(
  episode: EpisodeDraft,
  lines: ParsedLine[],
  client: Anthropic,
): Promise<Candidate[]> {
  try {
    const renderedLines = renderLines(lines);
    const startLine = lines[0]?.lineNumber ?? episode.startLine;
    const endLine = lines[lines.length - 1]?.lineNumber ?? episode.endLine;

    const userMessage = `Episode from ${episode.date} (${episode.projectDir}/${episode.sessionId})\nLines ${startLine}-${endLine}:\n\n${renderedLines.map((line) => `[Line ${line.lineNumber}] (${line.type}): ${line.content}`).join('\n')}`;

    // NOTE: calling client.beta.promptCaching.messages.create directly (not via
    // a detached function reference) is required — the SDK's Messages class
    // reads `this._client` inside create(), and casting/assigning the method
    // to a bare function type strips its `this` binding, making `this`
    // undefined at call time (`Cannot read properties of undefined (reading
    // '_client')`). This was a real bug: every real API call failed this way
    // while unit tests passed, since they mock the client and never exercise
    // real `this` binding.
    const response = (await client.beta.promptCaching.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      // Pinned to 0 for run-to-run consistency — confirmed claude-haiku-4-5
      // accepts this param (unlike claude-sonnet-5, used in sonnet.ts and
      // synthesis.ts, which rejects `temperature` outright with a 400
      // "deprecated for this model" — confirmed against the real API at
      // both 0 and 0.3, do not re-add it there without re-verifying).
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
          name: 'emit_candidates',
          description: 'Emit extracted insight candidates',
          input_schema: {
            type: 'object' as const,
            properties: {
              candidates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
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
                    evidenceSnippet: { type: 'string' },
                  },
                  required: ['category', 'text', 'evidenceRef', 'evidenceSnippet'],
                },
              },
            },
            required: ['candidates'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_candidates' },
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

    if (toolUse.name !== 'emit_candidates') {
      throw new Error(`Expected tool_use named emit_candidates, got ${toolUse.name}`);
    }

    if (
      typeof toolUse.input !== 'object' ||
      toolUse.input === null ||
      !('candidates' in toolUse.input)
    ) {
      // A large episode's rendered transcript can produce more candidates
      // than fit in max_tokens=8192, truncating the tool_use JSON mid-array
      // (observed: 253,935-token episode, stop_reason "max_tokens") — this
      // used to throw straight to HaikuExtractionError and silently drop the
      // ENTIRE episode's insights. Bisect the episode's lines and retry each
      // half instead: smaller inputs produce proportionally smaller (and
      // still complete) candidate arrays.
      if ((response as any).stop_reason === 'max_tokens' && lines.length > MIN_SPLIT_LINES) {
        const mid = Math.floor(lines.length / 2);
        const [first, second] = await Promise.all([
          generateCandidatesForLines(episode, lines.slice(0, mid), client),
          generateCandidatesForLines(episode, lines.slice(mid), client),
        ]);
        return [...first, ...second];
      }
      throw new Error(
        `Tool input missing candidates field (stop_reason: ${(response as any).stop_reason}) — ` +
          'likely truncated by max_tokens if stop_reason is "max_tokens"',
      );
    }

    const candidates = toolUse.input.candidates;
    if (!Array.isArray(candidates)) {
      throw new Error(`Tool input candidates must be an array, got ${typeof candidates}`);
    }

    // safeParse per item, not .map(CandidateSchema.parse) — a single bad
    // item (e.g. Haiku emitting a category value outside the enum) used to
    // throw on the whole array via .parse(), discarding every OTHER valid
    // candidate in the same response and dropping the entire episode. Skip
    // just the offending item instead.
    const parsedCandidates: Candidate[] = [];
    for (const item of candidates) {
      const result = CandidateSchema.safeParse(item);
      if (result.success) {
        parsedCandidates.push(result.data);
      } else {
        console.error(
          `Skipping malformed candidate for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}:`,
          result.error.message,
        );
      }
    }
    return parsedCandidates;
  } catch (error) {
    console.error(
      `Haiku extraction error for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}:`,
      error,
    );
    throw new HaikuExtractionError(episode, error);
  }
}
