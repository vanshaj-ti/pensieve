import type Database from 'better-sqlite3';
import type Anthropic from '@anthropic-ai/sdk';
import type { EpisodeDraft } from '../chunk/episodes.js';
import type { Insight } from '../types.js';
import { generateCandidates, HaikuExtractionError } from './haiku.js';
import { verifyAndScore, getRecentInsights, type CandidateWithSource } from './sonnet.js';

export type PersistedEpisode = EpisodeDraft & { id: number };

export async function runExtraction(
  episodes: PersistedEpisode[],
  db: Database.Database,
  client: Anthropic,
): Promise<Insight[]> {
  const allCandidatesWithSource: CandidateWithSource[] = [];

  for (const episode of episodes) {
    try {
      const candidates = await generateCandidates(episode, client);
      for (const candidate of candidates) {
        allCandidatesWithSource.push({
          candidate,
          episodeId: episode.id,
        });
      }
    } catch (error) {
      if (error instanceof HaikuExtractionError) {
        console.error(
          `Skipping episode ${episode.sessionId}:${episode.startLine}-${episode.endLine} due to extraction error`,
        );
        continue;
      }
      throw error;
    }
  }

  if (allCandidatesWithSource.length === 0) {
    return [];
  }

  const recentHistory = getRecentInsights(db, 7);
  const insights = await verifyAndScore(allCandidatesWithSource, recentHistory, client);

  return insights;
}
