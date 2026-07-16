import Database from 'better-sqlite3';
import { Config } from '../config.js';
import { Insight } from '../types.js';
import { embedText } from './embeddings.js';
import { unpackEmbedding } from '../db/schema.js';

/**
 * Plain in-JS cosine comparison against every recent/same-batch embedding is
 * O(n) per insight and fine at v0/v1 scale (a handful of insights/day over a
 * few weeks of history). If insight_embeddings grows to thousands of rows
 * and this becomes a measurable bottleneck, the natural upgrade is the
 * sqlite-vec extension for ANN similarity search inside the same SQLite
 * file — no separate vector DB, same storage, just an indexed query instead
 * of scanning every row in JS. Not needed yet.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (normA * normB);
}

interface RecentEmbedding {
  insightId: number;
  embedding: number[];
}

function getRecentInsightEmbeddings(
  db: Database.Database,
  days: number = 7
): RecentEmbedding[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  const stmt = db.prepare(`
    SELECT ie.insight_id, ie.embedding
    FROM insight_embeddings ie
    JOIN insights i ON ie.insight_id = i.id
    WHERE i.created_at >= ?
    ORDER BY i.created_at DESC
  `);

  const rows = stmt.all(cutoffStr) as Array<{ insight_id: number; embedding: Buffer }>;
  return rows.map((row) => ({
    insightId: row.insight_id,
    embedding: unpackEmbedding(row.embedding),
  }));
}

export interface InsightWithEmbedding {
  insight: Insight;
  embedding: number[] | null;
}

/**
 * Embeds every insight up front (once per insight, regardless of how many
 * other insights or history rows it's later compared against) so dedup and
 * recurrence — two independent comparisons — never issue duplicate embedding
 * calls for the same text.
 */
async function embedAll(insights: Insight[], config: Config): Promise<InsightWithEmbedding[]> {
  const result: InsightWithEmbedding[] = [];
  for (const insight of insights) {
    const embedding = await embedText(insight.text, config);
    result.push({ insight, embedding });
  }
  return result;
}

/**
 * Same-batch dedup: collapses near-duplicate insights produced within one
 * run (e.g. two episodes both surfacing the same underlying fact) into a
 * single insight, using the highest-significance duplicate as the survivor.
 * This is the embeddings-based replacement for asking Sonnet to eyeball the
 * candidate list and merge duplicates via reasoning — same infra as
 * recurrence (cosine similarity over the same vectors), just compared
 * within today's batch instead of against history.
 *
 * Items with no embedding (embeddings disabled, or this specific call
 * failed) are never merged away — they pass through unchanged, since there
 * is no similarity signal to act on for them.
 */
export function dedupeInsightsByEmbedding(
  items: InsightWithEmbedding[],
  threshold: number
): InsightWithEmbedding[] {
  const n = items.length;
  const visited = new Array<boolean>(n).fill(false);
  const kept: InsightWithEmbedding[] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) {
      continue;
    }
    visited[i] = true;
    const current = items[i];

    if (current.embedding === null) {
      // No similarity signal available for this item — never merge it into
      // or out of a cluster; pass it through unchanged.
      kept.push(current);
      continue;
    }

    // Collect every not-yet-visited item similar enough to `current` into
    // one cluster, marking each visited exactly once so no index is ever
    // revisited as if it were a fresh, unclustered item.
    let survivor = current;
    for (let j = i + 1; j < n; j++) {
      if (visited[j]) {
        continue;
      }
      const other = items[j];
      if (other.embedding === null) {
        continue;
      }
      const similarity = cosineSimilarity(current.embedding, other.embedding);
      if (similarity >= threshold) {
        visited[j] = true;
        if (other.insight.significanceScore > survivor.insight.significanceScore) {
          survivor = other;
        }
      }
    }
    kept.push(survivor);
  }

  return kept;
}

export async function applyEmbeddingRecurrence(
  insights: Insight[],
  db: Database.Database,
  config: Config
): Promise<InsightWithEmbedding[]> {
  if (!config.embeddingsBaseUrl) {
    return insights.map((insight) => ({
      insight,
      embedding: null,
    }));
  }

  const recentEmbeddings = getRecentInsightEmbeddings(db, 7);
  const embedded = await embedAll(insights, config);
  const deduped = dedupeInsightsByEmbedding(embedded, config.recurrenceSimilarityThreshold);

  for (const item of deduped) {
    if (item.embedding === null) {
      continue;
    }

    let maxSimilarity = 0;
    let matchingInsightId: number | null = null;

    for (const recent of recentEmbeddings) {
      const similarity = cosineSimilarity(item.embedding, recent.embedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matchingInsightId = recent.insightId;
      }
    }

    if (maxSimilarity >= config.recurrenceSimilarityThreshold && matchingInsightId !== null) {
      item.insight.recurrenceOf = matchingInsightId;
    }
  }

  return deduped;
}
