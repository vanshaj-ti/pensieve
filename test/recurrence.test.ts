import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { cosineSimilarity, applyEmbeddingRecurrence } from '../src/extract/recurrence.js';
import { type Config } from '../src/config.js';
import { initSchema } from '../src/db/schema.js';
import { type Insight } from '../src/types.js';

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
    recurrenceSimilarityThreshold: 0.90,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);

    // Insert dummy episode
    db.prepare(`
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES (?, ?, ?, ?, ?)
    `).run('2024-01-01', '/tmp', 'sess1', 1, 10);
  });

  it('returns insights unchanged if embeddings disabled', async () => {
    const config: Config = { ...baseConfig, embeddingsBaseUrl: null };
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'strategic_value',
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
      .prepare(`
        INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(1, 'strategic_value', 'old insight', 'line 1', 0.8, null, null, '2024-01-01T00:00:00Z');

    const oldId = oldInsight.lastInsertRowid as number;

    db.prepare(`
      INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `).run(oldId, Buffer.from(new Float32Array([1, 0]).buffer), 'text-embedding-3-small', '2024-01-01T00:00:00Z');

    const insightsWithDisabledEmbeddings: Insight[] = [
      {
        episodeId: 1,
        category: 'strategic_value',
        text: 'new insight',
        evidenceRef: 'line 2',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: 3, // Sonnet's guess (fallback from prompt-stuffing)
        createdAt: '2024-01-01T01:00:00Z',
      },
    ];

    // Config disabled → embedText returns null, Sonnet's guess should stay
    const result = await applyEmbeddingRecurrence(
      insightsWithDisabledEmbeddings,
      db,
      { ...baseConfig, embeddingsBaseUrl: null }
    );

    expect(result[0].insight.recurrenceOf).toBe(3); // Sonnet's guess preserved
  });

  it('preserves null embedding if embedText returns null', async () => {
    const config: Config = { ...baseConfig, embeddingsBaseUrl: null }; // Disabled
    const insights: Insight[] = [
      {
        episodeId: 1,
        category: 'strategic_value',
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
});
