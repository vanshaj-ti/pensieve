import type Database from 'better-sqlite3';
import { Insight, InsightSchema, DerivedInsight, DerivedInsightSchema } from '../types.js';

/**
 * All work items for one specific run (project+session+label), regardless
 * of date — the derive-insights synthesis pass needs the full set for a
 * run, not a single day's slice. Distinct from getTopInsights, which is
 * date-scoped and used by the daily brief/dashboard drill-down views.
 */
export function getWorkItemsForRun(
  db: Database.Database,
  projectDir: string,
  sessionId: string,
  label: string,
): Insight[] {
  const rows = db
    .prepare(
      `
    SELECT
      i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
      i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.project_dir = ? AND e.session_id = ? AND e.label = ?
    ORDER BY i.created_at ASC
  `,
    )
    .all(projectDir, sessionId, label) as Array<{
    id: number;
    episode_id: number;
    category: string;
    text: string;
    evidence_ref: string;
    significance_score: number;
    effort_class: string;
    verified_by_git: boolean | null;
    recurrence_of: number | null;
    created_at: string;
  }>;

  return rows.map((row) =>
    InsightSchema.parse({
      id: row.id,
      episodeId: row.episode_id,
      category: row.category,
      text: row.text,
      evidenceRef: row.evidence_ref,
      significanceScore: row.significance_score,
      effortClass: row.effort_class,
      verifiedByGit: row.verified_by_git ? true : null,
      recurrenceOf: row.recurrence_of,
      createdAt: row.created_at,
    }),
  );
}

/** Persists a batch of derived insights for one run, replacing none — additive. */
export function insertDerivedInsights(
  db: Database.Database,
  derivedInsights: DerivedInsight[],
): void {
  const stmt = db.prepare(`
    INSERT INTO derived_insights (project_dir, session_id, label, insight_type, text, evidence_insight_ids, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((items: DerivedInsight[]) => {
    for (const item of items) {
      stmt.run(
        item.projectDir,
        item.sessionId,
        item.label,
        item.insightType,
        item.text,
        JSON.stringify(item.evidenceInsightIds),
        item.createdAt,
      );
    }
  });
  insertAll(derivedInsights);
}

/** All derived insights for one run (project+session+label), newest first. */
export function getDerivedInsights(
  db: Database.Database,
  projectDir: string,
  sessionId: string,
  label?: string,
): DerivedInsight[] {
  const whereClause = label !== undefined ? 'AND label = ?' : '';
  const params = label !== undefined ? [projectDir, sessionId, label] : [projectDir, sessionId];

  const rows = db
    .prepare(
      `
    SELECT id, project_dir, session_id, label, insight_type, text, evidence_insight_ids, created_at
    FROM derived_insights
    WHERE project_dir = ? AND session_id = ? ${whereClause}
    ORDER BY created_at DESC
  `,
    )
    .all(...params) as Array<{
    id: number;
    project_dir: string;
    session_id: string;
    label: string;
    insight_type: string;
    text: string;
    evidence_insight_ids: string;
    created_at: string;
  }>;

  return rows.map((row) =>
    DerivedInsightSchema.parse({
      id: row.id,
      projectDir: row.project_dir,
      sessionId: row.session_id,
      label: row.label,
      insightType: row.insight_type,
      text: row.text,
      evidenceInsightIds: JSON.parse(row.evidence_insight_ids),
      createdAt: row.created_at,
    }),
  );
}
