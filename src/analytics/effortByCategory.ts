import type Database from 'better-sqlite3';
import { buildFilterClause, type AnalyticsFilter } from './shared.js';

export interface EffortByCategoryPoint {
  category: string;
  toil: number;
  judgment: number;
  overhead: number;
  total: number;
}

/**
 * Cross-tab of category × effort_class — answers "which category is the
 * biggest time-sink" (unlike getEffortBreakdown, which only groups by
 * effort_class and can't say whether the toil came from friction_audit
 * or decision_record).
 */
export function getEffortByCategory(
  db: Database.Database,
  date: string,
  filter?: AnalyticsFilter,
): EffortByCategoryPoint[] {
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT i.category, i.effort_class, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date = ?${filterSql}
    GROUP BY i.category, i.effort_class
  `,
    )
    .all(date, ...filterParams) as Array<{
    category: string;
    effort_class: string;
    count: number;
  }>;

  const byCategory = new Map<string, { toil: number; judgment: number; overhead: number }>();
  for (const row of rows) {
    if (!byCategory.has(row.category)) {
      byCategory.set(row.category, { toil: 0, judgment: 0, overhead: 0 });
    }
    const counts = byCategory.get(row.category)!;
    if (
      row.effort_class === 'toil' ||
      row.effort_class === 'judgment' ||
      row.effort_class === 'overhead'
    ) {
      counts[row.effort_class] = row.count;
    }
  }

  return Array.from(byCategory.entries())
    .map(([category, counts]) => ({
      category,
      ...counts,
      total: counts.toil + counts.judgment + counts.overhead,
    }))
    .sort((a, b) => b.total - a.total);
}
