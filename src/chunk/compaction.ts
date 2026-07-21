import type { ParsedLine } from '../ingest/parser.js';

/**
 * Compaction events surface as a `type: "user"` line carrying
 * `isCompactSummary: true` (the injected post-compaction summary message).
 * That line starts a new episode, so the boundary is recorded on the
 * *previous* parsed line's number — matching how splitEpisodes checks
 * compactionLineNumbers against prevLine.
 */
export function detectCompactionBoundaries(lines: ParsedLine[]): Set<number> {
  const boundaries = new Set<number>();

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].raw;
    const isCompactSummary =
      typeof raw === 'object' &&
      raw !== null &&
      (raw as Record<string, unknown>).isCompactSummary === true;

    if (isCompactSummary) {
      boundaries.add(lines[i - 1].lineNumber);
    }
  }

  return boundaries;
}
