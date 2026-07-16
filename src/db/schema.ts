import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Creates the sessions/episodes/insights tables (spec §7) if they don't already exist. */
export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      project_dir TEXT NOT NULL,
      session_id TEXT NOT NULL,
      last_line INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      PRIMARY KEY (project_dir, session_id)
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      session_id TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL REFERENCES episodes(id),
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      significance_score REAL NOT NULL,
      verified_by_git BOOLEAN,
      recurrence_of INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS insight_embeddings (
      insight_id INTEGER PRIMARY KEY REFERENCES insights(id),
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // CREATE TABLE IF NOT EXISTS above is a no-op against a pre-existing
  // insights table from before this column existed — ALTER TABLE ADD COLUMN
  // is the only way to add it to real databases created by earlier versions.
  // Default existing rows to 'judgment' (the least presumptuous guess: we
  // have no signal either way, and treating pre-existing insights as toil
  // by default would bias any future toil-ratio metric downward for free).
  const columns = db.prepare(`PRAGMA table_info(insights)`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'effort_class')) {
    db.exec(`ALTER TABLE insights ADD COLUMN effort_class TEXT NOT NULL DEFAULT 'judgment'`);
  }

  // Same migration-guard pattern as effort_class above: identifies which
  // pipeline run produced an episode ('' = unlabeled/pre-migration data).
  const episodeColumns = db.prepare(`PRAGMA table_info(episodes)`).all() as Array<{
    name: string;
  }>;
  if (!episodeColumns.some((c) => c.name === 'label')) {
    db.exec(`ALTER TABLE episodes ADD COLUMN label TEXT NOT NULL DEFAULT ''`);
  }
}

export function packEmbedding(vec: number[]): Buffer {
  return Buffer.from(Float32Array.from(vec).buffer);
}

export function unpackEmbedding(buf: Buffer): number[] {
  // Note: sqlite-vec would be the natural upgrade if insight_embeddings grows to thousands of rows.
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

/** Opens (creating parent dirs as needed) the SQLite file at `path` and ensures schema exists. */
export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  initSchema(db);
  return db;
}
