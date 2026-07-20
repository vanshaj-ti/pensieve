import type Database from 'better-sqlite3';
import { Insight, InsightSchema } from '../types.js';
import {
  buildFilterClause,
  buildDateClause,
  type AnalyticsFilter,
  type DateRange,
} from './shared.js';

export interface TopInsight extends Insight {
  projectDir: string;
  sessionId: string;
  label: string;
}

export function getTopInsights(
  db: Database.Database,
  range: DateRange,
  limit: number,
  filter?: AnalyticsFilter,
  offset: number = 0,
): TopInsight[] {
  const { sql: dateSql, params: dateParams } = buildDateClause(range);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT
      i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
      i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at,
      e.project_dir, e.session_id, e.label
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE ${dateSql}${filterSql}
    ORDER BY i.significance_score DESC
    LIMIT ?
    OFFSET ?
  `,
    )
    .all(...dateParams, ...filterParams, limit, offset) as Array<{
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
    session_id: string;
    label: string;
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
    return {
      ...validated,
      projectDir: row.project_dir,
      sessionId: row.session_id,
      label: row.label,
    };
  });
}

export function getTopInsightsCount(
  db: Database.Database,
  range: DateRange,
  filter?: AnalyticsFilter,
): number {
  const { sql: dateSql, params: dateParams } = buildDateClause(range);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const row = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE ${dateSql}${filterSql}
  `,
    )
    .get(...dateParams, ...filterParams) as { count: number };

  return row.count;
}
