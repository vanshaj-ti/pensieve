import type Database from 'better-sqlite3';

export type JobKind = 'analyze' | 'derive_insights';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobRecord {
  status: JobStatus;
  result?: Record<string, unknown>;
  error?: string;
}

const JOB_TTL_MS = 24 * 60 * 60 * 1000;

export function createJob(
  db: Database.Database,
  id: string,
  kind: JobKind,
  status: JobStatus,
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO jobs (id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  stmt.run(id, kind, status, now, now);
}

export function updateJob(
  db: Database.Database,
  id: string,
  patch: { status: JobStatus; result?: Record<string, unknown>; error?: string },
): void {
  const now = new Date().toISOString();
  const result = patch.result ? JSON.stringify(patch.result) : null;
  const error = patch.error ?? null;
  const stmt = db.prepare(
    'UPDATE jobs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?',
  );
  stmt.run(patch.status, result, error, now, id);
}

export function getJob(db: Database.Database, id: string): JobRecord | undefined {
  const stmt = db.prepare('SELECT status, result, error FROM jobs WHERE id = ?');
  const row = stmt.get(id) as
    { status: string; result: string | null; error: string | null } | undefined;
  if (!row) return undefined;

  const record: JobRecord = {
    status: row.status as JobStatus,
  };
  if (row.result) {
    record.result = JSON.parse(row.result);
  }
  if (row.error) {
    record.error = row.error;
  }
  return record;
}

export function evictOldJobs(db: Database.Database, olderThanMs: number): void {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const stmt = db.prepare("DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ?");
  stmt.run(cutoff);
}

export { JOB_TTL_MS };
