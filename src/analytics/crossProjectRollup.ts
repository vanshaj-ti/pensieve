import type Database from 'better-sqlite3';

export interface ProjectRollup {
  projectDir: string;
  insightCount: number;
}

export function getCrossProjectRollup(db: Database.Database, date: string): ProjectRollup[] {
  const rows = db
    .prepare(
      `
    SELECT e.project_dir, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date = ?
    GROUP BY e.project_dir
    ORDER BY count DESC
  `,
    )
    .all(date) as Array<{
    project_dir: string;
    count: number;
  }>;

  return rows.map((row) => ({
    projectDir: row.project_dir,
    insightCount: row.count,
  }));
}
