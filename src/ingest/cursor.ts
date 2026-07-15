import type Database from 'better-sqlite3';

export function getCursor(
  db: Database.Database,
  projectDir: string,
  sessionId: string,
): number {
  const row = db
    .prepare('SELECT last_line FROM sessions WHERE project_dir = ? AND session_id = ?')
    .get(projectDir, sessionId) as { last_line: number } | undefined;
  return row?.last_line ?? 0;
}

export function getLastRunAt(
  db: Database.Database,
  projectDir: string,
  sessionId: string,
): string | null {
  const row = db
    .prepare('SELECT last_run_at FROM sessions WHERE project_dir = ? AND session_id = ?')
    .get(projectDir, sessionId) as { last_run_at: string | null } | undefined;
  return row?.last_run_at ?? null;
}

export function advanceCursor(
  db: Database.Database,
  projectDir: string,
  sessionId: string,
  newLastLine: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (project_dir, session_id, last_line, last_run_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_dir, session_id) DO UPDATE SET
       last_line = excluded.last_line,
       last_run_at = excluded.last_run_at`,
  ).run(projectDir, sessionId, newLastLine, now);
}

export function effectiveStartLine(
  db: Database.Database,
  projectDir: string,
  sessionId: string,
  force = false,
): number {
  return force ? 0 : getCursor(db, projectDir, sessionId);
}
