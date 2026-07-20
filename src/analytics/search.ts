import type Database from 'better-sqlite3';

export interface SearchResult {
  type: 'project' | 'session' | 'insight';
  projectDir: string;
  sessionId?: string;
  label?: string;
  insightId?: number;
  text: string;
}

export function search(db: Database.Database, query: string, limit = 20): SearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const pattern = `%${trimmed}%`;
  const perTypeLimit = Math.ceil(limit / 3);

  const results: SearchResult[] = [];

  // Projects
  const projectRows = db
    .prepare(`SELECT DISTINCT project_dir FROM episodes WHERE project_dir LIKE ? LIMIT ?`)
    .all(pattern, perTypeLimit) as Array<{ project_dir: string }>;

  for (const row of projectRows) {
    results.push({
      type: 'project',
      projectDir: row.project_dir,
      text: row.project_dir,
    });
  }

  // Sessions
  const sessionRows = db
    .prepare(
      `SELECT DISTINCT project_dir, session_id FROM episodes WHERE session_id LIKE ? LIMIT ?`,
    )
    .all(pattern, perTypeLimit) as Array<{ project_dir: string; session_id: string }>;

  for (const row of sessionRows) {
    results.push({
      type: 'session',
      projectDir: row.project_dir,
      sessionId: row.session_id,
      text: row.session_id,
    });
  }

  // Insights
  const insightRows = db
    .prepare(
      `
    SELECT i.id, i.text, e.project_dir, e.session_id, e.label
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE i.text LIKE ?
    ORDER BY i.significance_score DESC
    LIMIT ?
  `,
    )
    .all(pattern, perTypeLimit) as Array<{
    id: number;
    text: string;
    project_dir: string;
    session_id: string;
    label: string;
  }>;

  for (const row of insightRows) {
    results.push({
      type: 'insight',
      projectDir: row.project_dir,
      sessionId: row.session_id,
      label: row.label,
      insightId: row.id,
      text: row.text,
    });
  }

  return results.slice(0, limit);
}
