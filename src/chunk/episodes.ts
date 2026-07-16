import type { Config } from '../config.js';
import type { ParsedLine } from '../ingest/parser.js';

export interface EpisodeDraft {
  date: string;
  projectDir: string;
  sessionId: string;
  startLine: number;
  endLine: number;
  lines: ParsedLine[];
}

export interface ChunkOptions {
  compactionLineNumbers?: Set<number>;
}

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function bucketByDay(lines: ParsedLine[]): Map<string, ParsedLine[]> {
  const buckets = new Map<string, ParsedLine[]>();

  for (const line of lines) {
    const date = new Date(line.timestamp);
    const key = localDateKey(date);

    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key)!.push(line);
  }

  return buckets;
}

/** Rough chars-per-token estimate for budget checks (no tokenizer dependency). */
const CHARS_PER_TOKEN = 4;

/**
 * Ceiling on estimated tokens per episode sent to Haiku. Set well under the
 * 200k model context limit to leave headroom for the system prompt, the
 * rendered-line formatting overhead (timestamps/type tags), and the tool
 * schema — a raw JSON size close to 200k tokens still overflows once rendered.
 */
export const MAX_EPISODE_TOKENS = 150_000;

function estimateTokens(lines: ParsedLine[]): number {
  let chars = 0;
  for (const line of lines) {
    chars += JSON.stringify(line.raw ?? '').length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Recursively halves an oversized episode until every piece fits under
 * maxTokens. A single-line episode is returned as-is even if it alone
 * exceeds the budget — there is nothing smaller left to split.
 */
function splitByTokenBudget(
  episode: { startLine: number; endLine: number; lines: ParsedLine[] },
  maxTokens: number,
): { startLine: number; endLine: number; lines: ParsedLine[] }[] {
  if (episode.lines.length <= 1 || estimateTokens(episode.lines) <= maxTokens) {
    return [episode];
  }

  const mid = Math.floor(episode.lines.length / 2);
  const left = episode.lines.slice(0, mid);
  const right = episode.lines.slice(mid);

  const leftEpisode = {
    startLine: left[0].lineNumber,
    endLine: left[left.length - 1].lineNumber,
    lines: left,
  };
  const rightEpisode = {
    startLine: right[0].lineNumber,
    endLine: right[right.length - 1].lineNumber,
    lines: right,
  };

  return [
    ...splitByTokenBudget(leftEpisode, maxTokens),
    ...splitByTokenBudget(rightEpisode, maxTokens),
  ];
}

export function splitEpisodes(
  lines: ParsedLine[],
  config: Config,
  opts?: ChunkOptions,
): { startLine: number; endLine: number; lines: ParsedLine[] }[] {
  if (lines.length === 0) {
    return [];
  }

  const episodes: { startLine: number; endLine: number; lines: ParsedLine[] }[] = [];
  let episodeStartIdx = 0;

  for (let i = 1; i < lines.length; i++) {
    const prevLine = lines[i - 1];
    const currLine = lines[i];

    const gapMs = new Date(currLine.timestamp).getTime() - new Date(prevLine.timestamp).getTime();
    const thresholdMs = config.idleGapMinutes * 60_000;

    const compactionSplit = opts?.compactionLineNumbers?.has(prevLine.lineNumber) ?? false;
    const idleGapSplit = gapMs > thresholdMs;

    if (idleGapSplit || compactionSplit) {
      const episodeLines = lines.slice(episodeStartIdx, i);
      episodes.push({
        startLine: episodeLines[0].lineNumber,
        endLine: episodeLines[episodeLines.length - 1].lineNumber,
        lines: episodeLines,
      });
      episodeStartIdx = i;
    }
  }

  const finalEpisodeLines = lines.slice(episodeStartIdx);
  episodes.push({
    startLine: finalEpisodeLines[0].lineNumber,
    endLine: finalEpisodeLines[finalEpisodeLines.length - 1].lineNumber,
    lines: finalEpisodeLines,
  });

  return episodes.flatMap((episode) => splitByTokenBudget(episode, MAX_EPISODE_TOKENS));
}
