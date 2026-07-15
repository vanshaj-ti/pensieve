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

  return episodes;
}
