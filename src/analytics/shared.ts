export function localDateKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Narrows an analytics query to one run label, project, and/or session — all optional, combinable. */
export interface AnalyticsFilter {
  label?: string;
  projectDir?: string;
  sessionId?: string;
}

/**
 * Builds an ` AND e.<col> = ?` fragment (aliasing episodes as `e`, matching
 * every analytics query's existing join) plus its bound params, for each
 * filter field that's set. Appended after a query's existing WHERE clause.
 */
export function buildFilterClause(filter?: AnalyticsFilter): { sql: string; params: unknown[] } {
  if (!filter) {
    return { sql: '', params: [] };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.label !== undefined) {
    conditions.push('e.label = ?');
    params.push(filter.label);
  }
  if (filter.projectDir !== undefined) {
    conditions.push('e.project_dir = ?');
    params.push(filter.projectDir);
  }
  if (filter.sessionId !== undefined) {
    conditions.push('e.session_id = ?');
    params.push(filter.sessionId);
  }

  return {
    sql: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '',
    params,
  };
}
