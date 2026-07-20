import type Database from 'better-sqlite3';
import {
  buildFilterClause,
  buildDateClause,
  type AnalyticsFilter,
  type DateRange,
} from './shared.js';

export interface ProjectRollup {
  projectDir: string;
  insightCount: number;
}

export interface ProjectEffortBreakdown {
  projectDir: string;
  toil: number;
  judgment: number;
  overhead: number;
  total: number;
  toilRatio: number;
  judgmentRatio: number;
  overheadRatio: number;
}

export function getCrossProjectRollup(
  db: Database.Database,
  range: DateRange,
  filter?: AnalyticsFilter,
): ProjectRollup[] {
  const { sql: dateSql, params: dateParams } = buildDateClause(range);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT e.project_dir, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE ${dateSql}${filterSql}
    GROUP BY e.project_dir
    ORDER BY count DESC
  `,
    )
    .all(...dateParams, ...filterParams) as Array<{
    project_dir: string;
    count: number;
  }>;

  return rows.map((row) => ({
    projectDir: row.project_dir,
    insightCount: row.count,
  }));
}

export function getProjectEffortBreakdown(
  db: Database.Database,
  date: string,
  filter?: AnalyticsFilter,
): ProjectEffortBreakdown[] {
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT e.project_dir, i.effort_class, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date = ?${filterSql}
    GROUP BY e.project_dir, i.effort_class
  `,
    )
    .all(date, ...filterParams) as Array<{
    project_dir: string;
    effort_class: string;
    count: number;
  }>;

  const byProject = new Map<string, { toil: number; judgment: number; overhead: number }>();

  for (const row of rows) {
    if (!byProject.has(row.project_dir)) {
      byProject.set(row.project_dir, { toil: 0, judgment: 0, overhead: 0 });
    }
    const breakdown = byProject.get(row.project_dir)!;
    if (row.effort_class === 'toil') breakdown.toil += row.count;
    else if (row.effort_class === 'judgment') breakdown.judgment += row.count;
    else if (row.effort_class === 'overhead') breakdown.overhead += row.count;
  }

  return Array.from(byProject.entries())
    .map(([projectDir, counts]) => {
      const total = counts.toil + counts.judgment + counts.overhead;
      return {
        projectDir,
        toil: counts.toil,
        judgment: counts.judgment,
        overhead: counts.overhead,
        total,
        toilRatio: total > 0 ? counts.toil / total : 0,
        judgmentRatio: total > 0 ? counts.judgment / total : 0,
        overheadRatio: total > 0 ? counts.overhead / total : 0,
      };
    })
    .sort((a, b) => b.toil - a.toil);
}
