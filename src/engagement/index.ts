import type Database from 'better-sqlite3';
import type Anthropic from '@anthropic-ai/sdk';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PersistedEpisode } from '../extract/index.js';
import type { EngagementTurn } from '../types.js';
import { deriveTurnPairs, type TurnPair } from './turns.js';
import { classifyTurns, EngagementClassificationError } from './haiku.js';

/** Turn-pair batches are much smaller units than whole episodes, so a
 * higher concurrency than extract/index.ts's HAIKU_CONCURRENCY=5 is safe —
 * kept equal for now rather than tuned, per the plan's "don't
 * over-engineer" note; revisit if profiling shows headroom. */
const ENGAGEMENT_CONCURRENCY = 5;

/** Mirrors extract/index.ts's private mapWithConcurrency (not exported from
 * there) — small enough to duplicate rather than plumb a shared-utils
 * module through for one helper. Runs `fn` over every item with at most
 * `concurrency` calls in flight, returning results in input order. */
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

export type PersistedEngagementTurn = Omit<EngagementTurn, 'episodeId' | 'createdAt'> & {
  episodeId: number;
};

/** No accuracy self-check convention exists elsewhere in Pensieve to reuse
 * (verifiedByGit is a dormant, never-implemented Pass-3 stub) — this is a
 * minimal one built fresh for this feature: every run appends a fixed
 * sample of classified turns to a markdown file for manual review, so the
 * engagement ratio can be sanity-checked before being trusted. Not
 * blocking, not scored. */
const SPOT_CHECK_SAMPLE_SIZE = 10;

function appendSpotCheckSample(
  spotCheckPath: string,
  label: string,
  samples: Array<{ pair: TurnPair; candidate: PersistedEngagementTurn }>,
): void {
  if (samples.length === 0) {
    return;
  }
  mkdirSync(dirname(spotCheckPath), { recursive: true });
  const lines: string[] = [
    `\n## Spot-check sample — label \`${label}\` — ${new Date().toISOString()}\n`,
  ];
  for (const { pair, candidate } of samples.slice(0, SPOT_CHECK_SAMPLE_SIZE)) {
    lines.push(
      `### Human line ${candidate.humanLineNumber} — ${candidate.classification}` +
        (candidate.directiveNecessary !== null
          ? ` (necessary: ${candidate.directiveNecessary})`
          : ''),
    );
    lines.push(`**Agent turn:** ${pair.agentTurnText.slice(0, 500)}`);
    lines.push(`**Human turn:** ${pair.humanTurnText.slice(0, 500)}`);
    lines.push(`**Reason:** ${candidate.reason}\n`);
  }
  appendFileSync(spotCheckPath, lines.join('\n'));
}

export interface EngagementAnalysisOptions {
  /** Written to `<briefsDir>/../engagement-spotcheck-<label>.md` — a fixed
   * sample of classified turns for manual accuracy review, not blocking. */
  briefsDir?: string;
  label?: string;
}

/**
 * Classifies every human turn across a batch of episodes as babysitting
 * (directive) or good engagement (deliberative/corrective/acknowledgment) —
 * a separate concern from runExtraction's work-item categorization,
 * operating on raw turn pairs rather than episode-level content. Runs
 * independently per episode (each episode's turn pairs are self-contained,
 * same independence argument as runExtraction's episodes), tolerant of
 * per-episode failure: a failed episode contributes no turns rather than
 * failing the whole batch, matching runExtraction's per-episode isolation.
 */
export async function runEngagementAnalysis(
  episodes: PersistedEpisode[],
  db: Database.Database,
  client: Anthropic,
  options: EngagementAnalysisOptions = {},
): Promise<PersistedEngagementTurn[]> {
  const perEpisodeResults = await mapWithConcurrency(
    episodes,
    ENGAGEMENT_CONCURRENCY,
    async (episode) => {
      const pairs = deriveTurnPairs(episode.lines);
      if (pairs.length === 0) {
        return [];
      }
      try {
        const rawCandidates = await classifyTurns(episode, pairs, client);
        // Haiku can emit two classifications for the same humanLineNumber
        // in one response (real bug, found live: two rows persisted with
        // identical episode_id/human_line_number/created_at, meaning the
        // duplicate came from a single tool_use call, not a bisection
        // re-run — classifyTurnsForPairs's slice(0,mid)/slice(mid) split
        // never overlaps). Keep the first occurrence per line; nothing in
        // the schema enforces this itself.
        const seenLines = new Set<number>();
        const candidates = rawCandidates.filter((c) => {
          if (seenLines.has(c.humanLineNumber)) {
            console.error(
              `Dropping duplicate engagement classification for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine}, human line ${c.humanLineNumber}`,
            );
            return false;
          }
          seenLines.add(c.humanLineNumber);
          return true;
        });
        const persisted = candidates.map((c) => ({ ...c, episodeId: episode.id }));

        if (options.briefsDir && options.label) {
          const pairsByLine = new Map(pairs.map((p) => [p.humanLineNumber, p]));
          const samples = persisted
            .filter((c) => pairsByLine.has(c.humanLineNumber))
            .map((c) => ({ pair: pairsByLine.get(c.humanLineNumber)!, candidate: c }));
          const spotCheckPath = join(
            dirname(options.briefsDir),
            `engagement-spotcheck-${options.label}.md`,
          );
          appendSpotCheckSample(spotCheckPath, options.label, samples);
        }

        return persisted;
      } catch (error) {
        if (error instanceof EngagementClassificationError) {
          console.error(
            `Skipping engagement analysis for episode ${episode.sessionId}:${episode.startLine}-${episode.endLine} due to classification error`,
          );
          return [];
        }
        throw error;
      }
    },
  );

  return perEpisodeResults.flat();
}
