import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, packEmbedding, unpackEmbedding } from '../src/db/schema.js';

describe('insight_embeddings schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });

  it('creates insight_embeddings table', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='insight_embeddings'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('has correct columns', () => {
    const columns = db.pragma('table_info(insight_embeddings)') as Array<{
      name: string;
      type: string;
    }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('insight_id');
    expect(names).toContain('embedding');
    expect(names).toContain('model');
    expect(names).toContain('created_at');
  });

  it('enforces primary key on insight_id', () => {
    db.prepare(`
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES (?, ?, ?, ?, ?)
    `).run('2024-01-01', '/tmp', 'sess1', 1, 10);

    db.prepare(`
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 'strategic_value', 'test', 'line 1', 0.8, null, null, '2024-01-01T00:00:00Z');

    const embedding = [0.1, 0.2, 0.3];
    const packed = packEmbedding(embedding);

    db.prepare(`
      INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `).run(1, packed, 'text-embedding-3-small', '2024-01-01T00:00:00Z');

    expect(() => {
      db.prepare(`
        INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
        VALUES (?, ?, ?, ?)
      `).run(1, packed, 'text-embedding-3-small', '2024-01-01T00:00:00Z');
    }).toThrow();
  });
});

describe('packEmbedding / unpackEmbedding', () => {
  it('round-trips correctly', () => {
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const packed = packEmbedding(original);
    const unpacked = unpackEmbedding(packed);

    expect(unpacked).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(unpacked[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('handles empty vectors', () => {
    const original: number[] = [];
    const packed = packEmbedding(original);
    const unpacked = unpackEmbedding(packed);
    expect(unpacked).toHaveLength(0);
  });

  it('handles large vectors', () => {
    const original = Array.from({ length: 1536 }, (_, i) => Math.sin(i / 100));
    const packed = packEmbedding(original);
    const unpacked = unpackEmbedding(packed);

    expect(unpacked).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(unpacked[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('handles offset buffers', () => {
    const original = [0.1, 0.2, 0.3];
    const packed = packEmbedding(original);

    // Create a buffer with an offset (like better-sqlite3 might return)
    const largerBuffer = Buffer.alloc(packed.byteLength + 8);
    packed.copy(largerBuffer, 4);
    const offsetBuffer = largerBuffer.slice(4, 4 + packed.byteLength);

    const unpacked = unpackEmbedding(offsetBuffer);
    expect(unpacked).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(unpacked[i]).toBeCloseTo(original[i], 5);
    }
  });
});
