import type Database from 'better-sqlite3';
import {
  localDateKey,
  buildFilterClause,
  buildDateClause,
  type AnalyticsFilter,
  type DateRange,
} from './shared.js';

export interface EffortBreakdown {
  toil: number;
  judgment: number;
  overhead: number;
  total: number;
  toilRatio: number;
  judgmentRatio: number;
  overheadRatio: number;
}

export interface EffortBreakdownTrendPoint extends EffortBreakdown {
  date: string;
}

/**
 * The "how much of this was donkey work" metric: what fraction of a day's
 * insights came from toil (mechanical/repetitive work that shouldn't have
 * needed a human more than once) versus judgment (real skilled reasoning)
 * versus overhead (necessary but zero-signal cost). Counts insights, not
 * time — a duration-weighted version (using episode line-spans) is a
 * natural follow-up once this is validated as useful.
 */
export function getEffortBreakdown(
  db: Database.Database,
  range: DateRange,
  filter?: AnalyticsFilter,
): EffortBreakdown {
  const { sql: dateSql, params: dateParams } = buildDateClause(range);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT i.effort_class, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE ${dateSql}${filterSql}
    GROUP BY i.effort_class
  `,
    )
    .all(...dateParams, ...filterParams) as Array<{ effort_class: string; count: number }>;

  const counts = { toil: 0, judgment: 0, overhead: 0 };
  for (const row of rows) {
    if (
      row.effort_class === 'toil' ||
      row.effort_class === 'judgment' ||
      row.effort_class === 'overhead'
    ) {
      counts[row.effort_class] = row.count;
    }
  }

  const total = counts.toil + counts.judgment + counts.overhead;

  return {
    ...counts,
    total,
    toilRatio: total > 0 ? counts.toil / total : 0,
    judgmentRatio: total > 0 ? counts.judgment / total : 0,
    overheadRatio: total > 0 ? counts.overhead / total : 0,
  };
}

export function getEffortBreakdownTrend(
  db: Database.Database,
  days: number,
  filter?: AnalyticsFilter,
): EffortBreakdownTrendPoint[] {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffDate = localDateKey(cutoffMs);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT e.date, i.effort_class, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date >= ?${filterSql}
    GROUP BY e.date, i.effort_class
    ORDER BY e.date ASC
  `,
    )
    .all(cutoffDate, ...filterParams) as Array<{
    date: string;
    effort_class: string;
    count: number;
  }>;

  const dateMap = new Map<string, { toil: number; judgment: number; overhead: number }>();
  const dates = new Set<string>();

  for (const row of rows) {
    dates.add(row.date);
    if (!dateMap.has(row.date)) {
      dateMap.set(row.date, { toil: 0, judgment: 0, overhead: 0 });
    }
    const counts = dateMap.get(row.date)!;
    if (
      row.effort_class === 'toil' ||
      row.effort_class === 'judgment' ||
      row.effort_class === 'overhead'
    ) {
      counts[row.effort_class] = row.count;
    }
  }

  const sortedDates = Array.from(dates).sort();
  return sortedDates.map((date) => {
    const counts = dateMap.get(date)!;
    const total = counts.toil + counts.judgment + counts.overhead;
    return {
      date,
      toil: counts.toil,
      judgment: counts.judgment,
      overhead: counts.overhead,
      total,
      toilRatio: total > 0 ? counts.toil / total : 0,
      judgmentRatio: total > 0 ? counts.judgment / total : 0,
      overheadRatio: total > 0 ? counts.overhead / total : 0,
    };
  });
}
