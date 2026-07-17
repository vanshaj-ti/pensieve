import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, packEmbedding, unpackEmbedding } from '../src/db/schema.js';
import type Database from 'better-sqlite3';

let dir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pensieve-test-'));
  dbPath = join(dir, 'pensieve.db');
  db = openDb(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function columnNames(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('initSchema', () => {
  it('creates sessions, episodes, insights tables', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['sessions', 'episodes', 'insights']));
  });

  it('sessions has expected columns', () => {
    expect(columnNames('sessions')).toEqual(
      expect.arrayContaining(['project_dir', 'session_id', 'last_line', 'last_run_at']),
    );
  });

  it('episodes has expected columns including label', () => {
    expect(columnNames('episodes')).toEqual(
      expect.arrayContaining([
        'id',
        'date',
        'project_dir',
        'session_id',
        'start_line',
        'end_line',
        'label',
      ]),
    );
  });

  it('backfills label with default empty string for pre-existing rows', () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES ('2024-01-01', '/tmp', 'sess1', 1, 10)
    `,
    ).run();

    const row = db.prepare('SELECT label FROM episodes WHERE session_id = ?').get('sess1') as {
      label: string;
    };
    expect(row.label).toBe('');
  });

  it('insights has expected columns including reserved verified_by_git and recurrence_of', () => {
    expect(columnNames('insights')).toEqual(
      expect.arrayContaining([
        'id',
        'episode_id',
        'category',
        'text',
        'evidence_ref',
        'significance_score',
        'verified_by_git',
        'recurrence_of',
        'created_at',
      ]),
    );
  });

  it('is idempotent (safe to call twice against the same db)', () => {
    expect(() => openDb(dbPath)).not.toThrow();
  });

  it('creates insight_embeddings table', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toContain('insight_embeddings');
  });

  it('insight_embeddings has correct columns', () => {
    expect(columnNames('insight_embeddings')).toEqual(
      expect.arrayContaining(['insight_id', 'embedding', 'model', 'created_at']),
    );
  });

  it('insight_embeddings enforces primary key on insight_id', () => {
    db.prepare(
      `
      INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run('2024-01-01', '/tmp', 'sess1', 1, 10);

    db.prepare(
      `
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(1, 'architecture_decisions', 'test', 'line 1', 0.8, null, null, '2024-01-01T00:00:00Z');

    const embedding = [0.1, 0.2, 0.3];
    const packed = packEmbedding(embedding);

    db.prepare(
      `
      INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `,
    ).run(1, packed, 'text-embedding-3-small', '2024-01-01T00:00:00Z');

    expect(() => {
      db.prepare(
        `
        INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run(1, packed, 'text-embedding-3-small', '2024-01-01T00:00:00Z');
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
