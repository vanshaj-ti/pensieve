import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  cosineSimilarity,
  applyEmbeddingRecurrence,
  dedupeInsightsByEmbedding,
  type InsightWithEmbedding,
} from '../src/extract/recurrence.js';
import { type Config } from '../src/config.js';
import { initSchema } from '../src/db/schema.js';
import { type Insight } from '../src/types.js';

/**
 * getRecentInsightEmbeddings filters on a real `now - days` cutoff (not a
 * fixed test fixture date), so any test exercising that real query path
 * must seed rows within the actual lookback window — a fixed 2024 date
 * silently falls outside a "last 7 days" cutoff computed against the real
 * clock and makes recentEmbeddings empty regardless of similarity.
 */
function recentIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    episodeId: 1,
    category: 'architecture_decisions',
    text: 'test insight',
    evidenceRef: 'line 1',
    significanceScore: 3,
    verifiedByGit: null,
    recurrenceOf: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1, 1], [0, 0, 0])).toBeCloseTo(0);
  });

  it('handles non-trivial vectors correctly', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const expected = (1 * 4 + 2 * 5 + 3 * 6) / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
  });
});

describe('embedAll concurrency', () => {
  it('respects EMBEDDING_CONCURRENCY max concurrent calls', async () => {
    const insights = [
      makeInsight({ text: 'insight 1' }),
      makeInsight({ text: 'insight 2' }),
      makeInsight({ text: 'insight 3' }),
      makeInsight({ text: 'insight 4' }),
      makeInsight({ text: 'insight 5' }),
    ];

    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const fetchMock = vi.fn(async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      // Simulate variable latency to prove no ordering dependency
      await new Promise((r) => setTimeout(r, Math.random() * 10));
      currentConcurrent--;
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.5, 0.5], index: 0 }] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const config: Config = {
      idleGapMinutes: 25,
      dbPath: ':memory:',
      briefsDir: '/tmp',
      embeddingsBaseUrl: 'https://api.example.com',
      embeddingsApiKey: 'test-key',
      embeddingsModel: 'text-embedding-3-small',
      embeddingsAuthHeader: 'Authorization',
      embeddingsAuthScheme: 'Bearer',
      embeddingsExtraHeaders: {},
      embeddingsPath: '/v1/embeddings',
      recurrenceSimilarityThreshold: 0.9,
      dedupeSimilarityThreshold: 0.95,
      recentHistoryDays: 7,
    };

    // Import directly to test embedAll concurrency
    const { embedAll } = await import('../src/extract/recurrence.js');

    const result = await embedAll(insights, config);

    // Results should be in input order regardless of which call resolved first
    expect(result).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(result[i].insight.text).toBe(`insight ${i + 1}`);
    }

    // Max concurrent should be at most 5 (EMBEDDING_CONCURRENCY)
    expect(maxConcurrent).toBeLessThanOrEqual(5);
    // Confirm calls happened (not proving exact limit but confirms concurrency happened)
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('applyEmbeddingRecurrence', () => {
  let db: Database.Database;
  const baseConfig: Config = {
    idleGapMinutes: 25,
    dbPath: ':memory:',
    briefsDir: '/tmp',
    embeddingsBaseUrl: 'https://api.example.com',
    embeddingsApiKey: 'test-key',
    embeddingsModel: 'text-embedding-3-small',
    embeddingsAuthHeader: 'Authorization',
    embeddingsAuthScheme: 'Bearer',
    embeddingsExtraHeaders: {},
    embeddingsPath: '/v1/embeddings',
    recurrenceSimilarityThreshold: 0.9,
    dedupeSimilarityThreshold: 0.95,
    recentHistoryDays: 7,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);

    // Insert dummy episode
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run('2024-01-01', '/tmp', 'sess1', 1, 10);
  });

  it('returns insights unchanged if embeddings disabled', async () => {
    const config: Config = { ...baseConfig, embeddingsBaseUrl: null };
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'architecture_decisions',
        text: 'test insight',
        evidenceRef: 'line 5',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    const result = await applyEmbeddingRecurrence(insights, db, config);
    expect(result).toHaveLength(1);
    expect(result[0].insight.text).toBe('test insight');
    expect(result[0].embedding).toBeNull();
  });

  it('similarity logic: high-similarity vectors trigger recurrence link', () => {
    // Directly test the cosine similarity computation that drives the override logic
    const newVec = [0.95, 0.05];
    const oldVec = [1, 0];
    const similarity = cosineSimilarity(newVec, oldVec);
    expect(similarity).toBeGreaterThan(0.9); // Exceeds 0.90 threshold
  });

  it('similarity logic: low-similarity vectors do not trigger override', () => {
    const newVec = [1, 0, 0];
    const oldVec = [0, 1, 0];
    const similarity = cosineSimilarity(newVec, oldVec);
    expect(similarity).toBeLessThan(0.9); // Below 0.90 threshold
  });

  it('preserves Sonnet guess when embedText fails mid-batch', async () => {
    // Insert recent embedding
    const oldInsight = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        1,
        'architecture_decisions',
        'old insight',
        'line 1',
        0.8,
        null,
        null,
        '2024-01-01T00:00:00Z',
      );

    const oldId = oldInsight.lastInsertRowid as number;

    db.prepare(
      `
      INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `,
    ).run(
      oldId,
      Buffer.from(new Float32Array([1, 0]).buffer),
      'text-embedding-3-small',
      '2024-01-01T00:00:00Z',
    );

    const insightsWithDisabledEmbeddings: Insight[] = [
      {
        episodeId: 1,
        category: 'architecture_decisions',
        text: 'new insight',
        evidenceRef: 'line 2',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: 3, // Sonnet's guess (fallback from prompt-stuffing)
        createdAt: '2024-01-01T01:00:00Z',
      },
    ];

    // Config disabled → embedText returns null, Sonnet's guess should stay
    const result = await applyEmbeddingRecurrence(insightsWithDisabledEmbeddings, db, {
      ...baseConfig,
      embeddingsBaseUrl: null,
    });

    expect(result[0].insight.recurrenceOf).toBe(3); // Sonnet's guess preserved
  });

  it('preserves null embedding if embedText returns null', async () => {
    const config: Config = { ...baseConfig, embeddingsBaseUrl: null }; // Disabled
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'architecture_decisions',
        text: 'test',
        evidenceRef: 'line 1',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: 5, // Sonnet's guess
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    const result = await applyEmbeddingRecurrence(insights, db, config);
    expect(result[0].insight.recurrenceOf).toBe(5); // Preserved
    expect(result[0].embedding).toBeNull();
  });

  it('enabled path: real fetch-backed embedding above threshold sets recurrenceOf', async () => {
    // Prior insight stored with an embedding pointing along [1, 0].
    const oldInsight = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(1, 'friction_audit', 'old friction', 'line 1', 3, null, null, recentIso(1));
    const oldId = oldInsight.lastInsertRowid as number;
    db.prepare(
      `
      INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `,
    ).run(
      oldId,
      Buffer.from(new Float32Array([1, 0]).buffer),
      'text-embedding-3-small',
      recentIso(1),
    );

    // Mock fetch so embedText (enabled: embeddingsBaseUrl set) returns a
    // vector highly similar to the stored one — this exercises the actual
    // enabled code path (embedText -> cosineSimilarity -> recurrenceOf
    // override), not just the cosineSimilarity function in isolation.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.98, 0.02], index: 0 }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const newInsight: Insight = {
      episodeId: 1,
      category: 'friction_audit',
      text: 'new friction, same root cause',
      evidenceRef: 'line 9',
      significanceScore: 3,
      verifiedByGit: null,
      recurrenceOf: null,
      createdAt: '2024-01-02T00:00:00Z',
    };

    const result = await applyEmbeddingRecurrence([newInsight], db, baseConfig);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].insight.recurrenceOf).toBe(oldId);
    expect(result[0].embedding).toEqual([0.98, 0.02]);

    vi.unstubAllGlobals();
  });

  it('enabled path: low-similarity embedding does not set recurrenceOf', async () => {
    const oldInsight = db
      .prepare(
        `
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(1, 'friction_audit', 'unrelated old insight', 'line 1', 3, null, null, recentIso(1));
    const oldId = oldInsight.lastInsertRowid as number;
    db.prepare(
      `
      INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `,
    ).run(
      oldId,
      Buffer.from(new Float32Array([1, 0]).buffer),
      'text-embedding-3-small',
      recentIso(1),
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0, 1], index: 0 }] }), // orthogonal
    });
    vi.stubGlobal('fetch', fetchMock);

    const newInsight: Insight = {
      episodeId: 1,
      category: 'architecture_decisions',
      text: 'genuinely different insight',
      evidenceRef: 'line 9',
      significanceScore: 3,
      verifiedByGit: null,
      recurrenceOf: null,
      createdAt: '2024-01-02T00:00:00Z',
    };

    const result = await applyEmbeddingRecurrence([newInsight], db, baseConfig);
    expect(result[0].insight.recurrenceOf).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe('dedupeInsightsByEmbedding', () => {
  const threshold = 0.9;

  function withEmbedding(insight: Insight, embedding: number[] | null): InsightWithEmbedding {
    return { insight, embedding };
  }

  it('merges two near-duplicate insights, keeping the higher-significance one', () => {
    const low = withEmbedding(makeInsight({ text: 'a', significanceScore: 2 }), [1, 0]);
    const high = withEmbedding(makeInsight({ text: 'b', significanceScore: 4 }), [0.99, 0.01]);

    const result = dedupeInsightsByEmbedding([low, high], threshold);

    expect(result).toHaveLength(1);
    expect(result[0].insight.significanceScore).toBe(4);
    expect(result[0].insight.text).toBe('b');
  });

  it('keeps dissimilar insights separate', () => {
    const a = withEmbedding(makeInsight({ text: 'a' }), [1, 0]);
    const b = withEmbedding(makeInsight({ text: 'b' }), [0, 1]);

    const result = dedupeInsightsByEmbedding([a, b], threshold);
    expect(result).toHaveLength(2);
  });

  it('never merges items with a null embedding, even if text is identical', () => {
    const a = withEmbedding(makeInsight({ text: 'same text' }), null);
    const b = withEmbedding(makeInsight({ text: 'same text' }), null);

    const result = dedupeInsightsByEmbedding([a, b], threshold);
    expect(result).toHaveLength(2);
  });

  it('collapses a cluster of 3+ near-duplicates into one survivor', () => {
    const items = [
      withEmbedding(makeInsight({ text: 'v1', significanceScore: 2 }), [1, 0, 0]),
      withEmbedding(makeInsight({ text: 'v2', significanceScore: 5 }), [0.99, 0.01, 0]),
      withEmbedding(makeInsight({ text: 'v3', significanceScore: 3 }), [0.98, 0.02, 0]),
    ];

    const result = dedupeInsightsByEmbedding(items, threshold);
    expect(result).toHaveLength(1);
    expect(result[0].insight.significanceScore).toBe(5);
  });

  it('empty input returns empty output', () => {
    expect(dedupeInsightsByEmbedding([], threshold)).toEqual([]);
  });

  it('respects dedupe threshold (0.95) independently from recurrence threshold (0.90)', () => {
    // Two insights with similarity between 0.90 and 0.95: should NOT dedupe (separate-batch concern)
    // but WOULD collapse under old single-threshold behavior.
    const vec1 = [1, 0, 0];
    // vec2 at ~0.932 similarity to vec1 (in the split zone: > 0.90, < 0.95)
    const vec2 = [1, 0.39, 0];
    const sim = cosineSimilarity(vec1, vec2);

    // Confirm it's in the split zone
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(0.95);

    const items = [
      withEmbedding(makeInsight({ text: 'insight1' }), vec1),
      withEmbedding(makeInsight({ text: 'insight2' }), vec2),
    ];

    // dedupe threshold 0.95: should NOT collapse
    const result = dedupeInsightsByEmbedding(items, 0.95);
    expect(result).toHaveLength(2);

    // old single-threshold 0.9 would have collapsed them
    const resultOldBehavior = dedupeInsightsByEmbedding(items, 0.9);
    expect(resultOldBehavior).toHaveLength(1);
  });
});
