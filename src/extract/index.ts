import type Database from 'better-sqlite3';
import type Anthropic from '@anthropic-ai/sdk';
import type { EpisodeDraft } from '../chunk/episodes.js';
import type { Insight } from '../types.js';
import type { Config } from '../config.js';
import { generateCandidates, HaikuExtractionError } from './haiku.js';
import {
  verifyAndScore,
  getRecentInsights,
  SonnetVerificationError,
  type CandidateWithSource,
} from './sonnet.js';

export type PersistedEpisode = EpisodeDraft & { id: number };

/**
 * Max concurrent Haiku calls in flight. Episodes are independent (no shared
 * state, no ordering dependency), so this is safe to run concurrently, not
 * sequentially. Bounded rather than unbounded Promise.all to avoid hammering
 * the API with every episode in a large session at once.
 */
const HAIKU_CONCURRENCY = 5;

/**
 * Sonnet's verify/score output is capped at max_tokens=16384 per call
 * (see sonnet.ts). On a large day, every episode's candidates used to go
 * into ONE Sonnet call — a real production failure: a 27k-line day (many
 * episodes worth of candidates) truncated the emit_insights tool response
 * entirely, dropping the whole day to zero insights. Batching candidates
 * into fixed-size chunks keeps each call's expected output comfortably
 * under the token budget regardless of how large a day's session is.
 */
/**
 * Flat item count, not token-budget-based (unlike chunk/episodes.ts's
 * MAX_EPISODE_TOKENS, which splits raw transcript lines that vary by orders
 * of magnitude in size). Each candidate here is a short, Haiku-bounded
 * {category, text, evidenceRef, evidenceSnippet} record with low per-item
 * size variance, and the real constraint this batching protects is Sonnet's
 * *output* token budget (max_tokens=16384 for the emitted insights array,
 * roughly one insight per input candidate) — not input size. A flat count
 * already tracks output size linearly and reliably; a token-counting input
 * budget would add complexity to guard against a risk (huge input) that
 * isn't the one actually in play here. Revisit only if real-world candidate
 * text sizes are observed to vary wildly (e.g. evidenceSnippet growing much
 * larger than intended).
 */
const SONNET_BATCH_SIZE = 40;
const SONNET_CONCURRENCY = 3;

/**
 * Runs `fn` over every item with at most `concurrency` calls in flight at
 * once, returning results in input order. No new dependency (no p-limit) —
 * a fixed-size pool of workers, each pulling the next unclaimed index until
 * the queue is exhausted.
 */
export async function mapWithConcurrency<T, R>(
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
  config: Config,
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

  const recentHistory = getRecentInsights(db, config.recentHistoryDays);

  const batches: CandidateWithSource[][] = [];
  for (let i = 0; i < allCandidatesWithSource.length; i += SONNET_BATCH_SIZE) {
    batches.push(allCandidatesWithSource.slice(i, i + SONNET_BATCH_SIZE));
  }

  const batchResults = await mapWithConcurrency(batches, SONNET_CONCURRENCY, async (batch) => {
    try {
      return await verifyAndScore(batch, recentHistory, client);
    } catch (error) {
      if (error instanceof SonnetVerificationError) {
        console.error(
          `Skipping Sonnet batch of ${batch.length} candidates due to verification error`,
        );
        return [];
      }
      throw error;
    }
  });

  return batchResults.flat();
}
