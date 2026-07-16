import type Database from 'better-sqlite3';

export function getInsightDates(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `
    SELECT DISTINCT e.date
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    ORDER BY e.date DESC
  `,
    )
    .all() as Array<{ date: string }>;

  return rows.map((row) => row.date);
}
