import type Database from 'better-sqlite3';
import { buildFilterClause, type AnalyticsFilter } from './shared.js';

export function getInsightDates(db: Database.Database, filter?: AnalyticsFilter): string[] {
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT DISTINCT e.date
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE 1=1${filterSql}
    ORDER BY e.date DESC
  `,
    )
    .all(...filterParams) as Array<{ date: string }>;

  return rows.map((row) => row.date);
}
