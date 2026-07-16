import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type RawLineType = 'user' | 'assistant';

export interface ParsedLine {
  lineNumber: number;
  type: RawLineType;
  timestamp: string;
  hasToolUse: boolean;
  raw: unknown;
}

export interface ParseResult {
  lines: ParsedLine[];
  maxLineNumber: number;
}

const NOISE_TYPES = new Set([
  'attachment',
  'mode',
  'permission-mode',
  'queue-operation',
  'system',
  'file-history-snapshot',
  'file-history-delta',
  'ai-title',
]);

export async function parseSessionLines(filePath: string, startLine = 0): Promise<ParseResult> {
  const lines: ParsedLine[] = [];
  let maxLineNumber = 0;
  let lineNumber = 0;

  const stream = createReadStream(filePath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    lineNumber++;
    maxLineNumber = lineNumber;

    if (!rawLine.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      console.warn(`[parser] ${filePath}:${lineNumber} invalid JSON, skipping`);
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      console.warn(
        `[parser] ${filePath}:${lineNumber} expected object, got ${typeof parsed}, skipping`,
      );
      continue;
    }

    const obj = parsed as Record<string, unknown>;
    const type = obj.type as string | undefined;

    if (type === 'user' || type === 'assistant') {
      if (lineNumber <= startLine) {
        continue;
      }

      const hasToolUse =
        type === 'assistant' &&
        typeof obj.message === 'object' &&
        obj.message !== null &&
        Array.isArray((obj.message as Record<string, unknown>).content) &&
        ((obj.message as Record<string, unknown>).content as unknown[]).some(
          (c: unknown) =>
            typeof c === 'object' && c !== null && 'type' in c && c.type === 'tool_use',
        );

      lines.push({
        lineNumber,
        type: type as RawLineType,
        timestamp: (obj.timestamp as string) || new Date().toISOString(),
        hasToolUse: hasToolUse || false,
        raw: parsed,
      });
    } else if (!NOISE_TYPES.has(type || '')) {
      console.warn(`[parser] ${filePath}:${lineNumber} unknown type "${type}", skipping`);
    }
  }

  return { lines, maxLineNumber };
}
