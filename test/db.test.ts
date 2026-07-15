import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/schema.js';
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
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(expect.arrayContaining(['sessions', 'episodes', 'insights']));
  });

  it('sessions has expected columns', () => {
    expect(columnNames('sessions')).toEqual(
      expect.arrayContaining(['project_dir', 'session_id', 'last_line', 'last_run_at']),
    );
  });

  it('episodes has expected columns', () => {
    expect(columnNames('episodes')).toEqual(
      expect.arrayContaining(['id', 'date', 'project_dir', 'session_id', 'start_line', 'end_line']),
    );
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
});
