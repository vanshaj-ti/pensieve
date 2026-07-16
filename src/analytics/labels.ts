import type Database from 'better-sqlite3';

export interface LabelSummary {
  label: string;
  count: number;
}

export interface ProjectSummary {
  projectDir: string;
  count: number;
}

export interface SessionSummary {
  projectDir: string;
  sessionId: string;
  count: number;
}

/** Distinct run labels with insight counts, for the dashboard's label filter dropdown. */
export function getLabels(db: Database.Database): LabelSummary[] {
  const rows = db
    .prepare(
      `
    SELECT e.label, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    GROUP BY e.label
    ORDER BY e.label ASC
  `,
    )
    .all() as Array<{ label: string; count: number }>;

  return rows.map((row) => ({ label: row.label, count: row.count }));
}

/** Distinct project dirs with insight counts, for the dashboard's project filter dropdown. */
export function getProjects(db: Database.Database): ProjectSummary[] {
  const rows = db
    .prepare(
      `
    SELECT e.project_dir, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    GROUP BY e.project_dir
    ORDER BY count DESC
  `,
    )
    .all() as Array<{ project_dir: string; count: number }>;

  return rows.map((row) => ({ projectDir: row.project_dir, count: row.count }));
}

/** Distinct sessions (optionally scoped to one project) with insight counts. */
export function getSessions(db: Database.Database, projectDir?: string): SessionSummary[] {
  const whereClause = projectDir !== undefined ? 'WHERE e.project_dir = ?' : '';
  const params = projectDir !== undefined ? [projectDir] : [];

  const rows = db
    .prepare(
      `
    SELECT e.project_dir, e.session_id, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    ${whereClause}
    GROUP BY e.project_dir, e.session_id
    ORDER BY count DESC
  `,
    )
    .all(...params) as Array<{ project_dir: string; session_id: string; count: number }>;

  return rows.map((row) => ({
    projectDir: row.project_dir,
    sessionId: row.session_id,
    count: row.count,
  }));
}

/**
 * Re-labels the episodes for one project+session that currently carry
 * oldLabel — scoped by oldLabel (not just project+session) so relabeling
 * one run doesn't bleed into other runs of the same session.
 */
export function updateLabelsForSession(
  db: Database.Database,
  projectDir: string,
  sessionId: string,
  oldLabel: string,
  newLabel: string,
): number {
  const stmt = db.prepare(
    `UPDATE episodes SET label = ? WHERE project_dir = ? AND session_id = ? AND label = ?`,
  );
  const info = stmt.run(newLabel, projectDir, sessionId, oldLabel);
  return info.changes;
}
