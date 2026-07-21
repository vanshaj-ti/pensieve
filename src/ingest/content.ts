/**
 * Shared content-block walker for Claude Code JSONL message payloads.
 *
 * A `ParsedLine.raw` is the untouched JSON object for one transcript line.
 * Its `message.content` is either a plain string or an array of blocks
 * (`text`, `tool_use`, `tool_result`) — this walks that shape once so
 * extraction (`extract/haiku.ts`) and turn-pair derivation
 * (`engagement/turns.ts`) don't each reimplement it.
 */
export interface RenderedContent {
  /** Flattened text: text blocks verbatim, tool_use/tool_result rendered
   * as bracketed markers, joined with newlines. */
  content: string;
  /** True if `message.content` is a plain string, or contains at least one
   * `type: 'text'` block. A `user`-type line with this false is NOT a real
   * human turn — it's a tool_result being echoed back (Claude Code nests
   * tool_result blocks inside `user`-role messages, mirroring the
   * Anthropic API's tool-result-as-user-turn convention). */
  hasText: boolean;
  hasToolUse: boolean;
  hasToolResult: boolean;
}

export function renderMessageContent(raw: unknown): RenderedContent {
  let content = '';
  let hasText = false;
  let hasToolUse = false;
  let hasToolResult = false;

  const rawObj = raw as Record<string, unknown> | null;
  if (rawObj && 'message' in rawObj) {
    const message = rawObj.message as Record<string, unknown> | null;
    if (message && 'content' in message) {
      if (typeof message.content === 'string') {
        content = message.content;
        hasText = content.length > 0;
      } else if (Array.isArray(message.content)) {
        const textParts: string[] = [];
        for (const block of message.content) {
          if (typeof block === 'object' && block !== null) {
            if ('type' in block && block.type === 'text' && 'text' in block) {
              textParts.push(String(block.text));
              hasText = true;
            } else if (
              'type' in block &&
              block.type === 'tool_use' &&
              'name' in block &&
              'input' in block
            ) {
              textParts.push(`[tool_use: ${String(block.name)}] ${JSON.stringify(block.input)}`);
              hasToolUse = true;
            } else if ('type' in block && block.type === 'tool_result' && 'content' in block) {
              hasToolResult = true;
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

  return { content, hasText, hasToolUse, hasToolResult };
}
