import type { ScanResult } from '../ingest/index.js';
import type { Config } from '../config.js';
import { bucketByDay, splitEpisodes, type ChunkOptions, type EpisodeDraft } from './episodes.js';

export function chunkSession(
  scanResult: Pick<ScanResult, 'projectDir' | 'sessionId' | 'lines'>,
  config: Config,
  opts?: ChunkOptions,
): EpisodeDraft[] {
  const dayBuckets = bucketByDay(scanResult.lines);
  const drafts: EpisodeDraft[] = [];

  for (const [date, dayLines] of dayBuckets) {
    const episodes = splitEpisodes(dayLines, config, opts);
    for (const episode of episodes) {
      drafts.push({
        date,
        projectDir: scanResult.projectDir,
        sessionId: scanResult.sessionId,
        startLine: episode.startLine,
        endLine: episode.endLine,
        lines: episode.lines,
      });
    }
  }

  return drafts;
  // TODO: run 4 will consume EpisodeDraft[] for Haiku/Sonnet extraction.
  // TODO: compaction detection (opts.compactionLineNumbers) is currently
  // always empty — see build summary for why; wire a real detector once
  // transcript data confirms the signal.
}

export type { EpisodeDraft, ChunkOptions } from './episodes.js';
