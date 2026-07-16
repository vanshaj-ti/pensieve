import type Database from 'better-sqlite3';
import { localDateKey } from './shared.js';

export interface CategoryTrendPoint {
  date: string;
  category: string;
  count: number;
}

export function getCategoryTrend(db: Database.Database, days: number): CategoryTrendPoint[] {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffDate = localDateKey(cutoffMs);

  const rows = db
    .prepare(
      `
    SELECT e.date, i.category, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date >= ?
    GROUP BY e.date, i.category
    ORDER BY e.date ASC, i.category ASC
  `,
    )
    .all(cutoffDate) as Array<{
    date: string;
    category: string;
    count: number;
  }>;

  return rows.map((row) => ({
    date: row.date,
    category: row.category,
    count: row.count,
  }));
}
