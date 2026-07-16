import type Database from 'better-sqlite3';
import { Insight, InsightSchema } from '../types.js';

export interface TopInsight extends Insight {
  projectDir: string;
}

export function getTopInsights(db: Database.Database, date: string, limit: number): TopInsight[] {
  const rows = db
    .prepare(
      `
    SELECT
      i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
      i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at, e.project_dir
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date = ?
    ORDER BY i.significance_score DESC
    LIMIT ?
  `,
    )
    .all(date, limit) as Array<{
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
    project_dir: string;
  }>;

  return rows.map((row) => {
    const validated = InsightSchema.parse({
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
    });
    return { ...validated, projectDir: row.project_dir };
  });
}
