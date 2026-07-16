import Database from 'better-sqlite3';
import { Config } from '../config.js';
import { Insight } from '../types.js';
import { embedText } from './embeddings.js';
import { unpackEmbedding } from '../db/schema.js';

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
  const result: InsightWithEmbedding[] = [];

  for (const insight of insights) {
    const embedding = await embedText(insight.text, config);

    if (embedding === null) {
      result.push({ insight, embedding: null });
      continue;
    }

    let maxSimilarity = 0;
    let matchingInsightId: number | null = null;

    for (const recent of recentEmbeddings) {
      const similarity = cosineSimilarity(embedding, recent.embedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matchingInsightId = recent.insightId;
      }
    }

    if (maxSimilarity >= config.recurrenceSimilarityThreshold && matchingInsightId !== null) {
      insight.recurrenceOf = matchingInsightId;
    }

    result.push({ insight, embedding });
  }

  return result;
}
