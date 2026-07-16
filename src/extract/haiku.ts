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

const SYSTEM_PROMPT = `You are an insight extraction system. Your task is to identify actionable insights from development session transcripts.

Extract insights that fall into one of these categories:
- strategic_value: Important decisions, architectural insights, or long-term strategic value
- decision_record: Key decisions made, their rationale, and implications
- friction_audit: Pain points, bottlenecks, inefficiencies, or obstacles encountered
- high_potential_seeds: Ideas, opportunities, or features with high potential impact
- ai_leverage: Opportunities to use AI to improve development velocity or quality
- ai_correction_load: Instances where the user had to correct AI output, signaling limitation areas

Be high-recall: over-include candidates rather than being conservative. False positives are filtered in downstream verification; false negatives are permanent misses.

For each insight, provide:
- category: One of the six categories above
- text: The insight text (will be polished downstream)
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

export async function generateCandidates(
  episode: EpisodeDraft,
  client: Anthropic,
): Promise<Candidate[]> {
  try {
    const renderedLines = renderLines(episode.lines);

    const userMessage = `Episode from ${episode.date} (${episode.projectDir}/${episode.sessionId})\nLines ${episode.startLine}-${episode.endLine}:\n\n${renderedLines.map((line) => `[Line ${line.lineNumber}] (${line.type}): ${line.content}`).join('\n')}`;

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
      throw new Error(
        `Tool input missing candidates field (stop_reason: ${(response as any).stop_reason}) — ` +
          'likely truncated by max_tokens if stop_reason is "max_tokens"',
      );
    }

    const candidates = toolUse.input.candidates;
    if (!Array.isArray(candidates)) {
      throw new Error(`Tool input candidates must be an array, got ${typeof candidates}`);
    }

    return candidates.map((item: unknown) => {
      const parsed = CandidateSchema.parse(item);
      return parsed;
    });
  } catch (error) {
    console.error(
      `Haiku extraction error for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}:`,
      error,
    );
    throw new HaikuExtractionError(episode, error);
  }
}
