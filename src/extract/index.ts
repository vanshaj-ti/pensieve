import type Database from 'better-sqlite3';
import type Anthropic from '@anthropic-ai/sdk';
import type { EpisodeDraft } from '../chunk/episodes.js';
import type { Insight } from '../types.js';
import { generateCandidates, HaikuExtractionError } from './haiku.js';
import { verifyAndScore, getRecentInsights, type CandidateWithSource } from './sonnet.js';

export type PersistedEpisode = EpisodeDraft & { id: number };

/**
 * Max concurrent Haiku calls in flight. Episodes are independent (no shared
 * state, no ordering dependency), so this is safe to run concurrently, not
 * sequentially. Bounded rather than unbounded Promise.all to avoid hammering
 * the API with every episode in a large session at once.
 */
const HAIKU_CONCURRENCY = 5;

/**
 * Runs `fn` over every item with at most `concurrency` calls in flight at
 * once, returning results in input order. No new dependency (no p-limit) —
 * a fixed-size pool of workers, each pulling the next unclaimed index until
 * the queue is exhausted.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runExtraction(
  episodes: PersistedEpisode[],
  db: Database.Database,
  client: Anthropic,
): Promise<Insight[]> {
  // Each episode independently produces either its candidates or `null`
  // (HaikuExtractionError — logged and skipped, matching the prior
  // sequential behavior exactly). Any other error still propagates and
  // rejects the whole call, same as before — concurrency only changes how
  // many episodes are in flight at once, not the error-handling contract.
  const perEpisodeResults = await mapWithConcurrency(
    episodes,
    HAIKU_CONCURRENCY,
    async (episode) => {
      try {
        return await generateCandidates(episode, client);
      } catch (error) {
        if (error instanceof HaikuExtractionError) {
          console.error(
            `Skipping episode ${episode.sessionId}:${episode.startLine}-${episode.endLine} due to extraction error`,
          );
          return null;
        }
        throw error;
      }
    },
  );

  const allCandidatesWithSource: CandidateWithSource[] = [];
  for (let i = 0; i < episodes.length; i++) {
    const candidates = perEpisodeResults[i];
    if (candidates === null) {
      continue;
    }
    for (const candidate of candidates) {
      allCandidatesWithSource.push({
        candidate,
        episodeId: episodes[i].id,
      });
    }
  }

  if (allCandidatesWithSource.length === 0) {
    return [];
  }

  const recentHistory = getRecentInsights(db, 7);
  const insights = await verifyAndScore(allCandidatesWithSource, recentHistory, client);

  return insights;
}
