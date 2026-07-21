import type { ScanResult } from '../ingest/index.js';
import type { Config } from '../config.js';
import { bucketByDay, splitEpisodes, type ChunkOptions, type EpisodeDraft } from './episodes.js';
import { detectCompactionBoundaries } from './compaction.js';

export function chunkSession(
  scanResult: Pick<ScanResult, 'projectDir' | 'sessionId' | 'lines'>,
  config: Config,
  opts?: ChunkOptions,
): EpisodeDraft[] {
  const compactionLineNumbers =
    opts?.compactionLineNumbers ?? detectCompactionBoundaries(scanResult.lines);
  const effectiveOpts: ChunkOptions = { ...opts, compactionLineNumbers };

  const dayBuckets = bucketByDay(scanResult.lines);
  const drafts: EpisodeDraft[] = [];

  for (const [date, dayLines] of dayBuckets) {
    const episodes = splitEpisodes(dayLines, config, effectiveOpts);
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
}

export type { EpisodeDraft, ChunkOptions } from './episodes.js';
