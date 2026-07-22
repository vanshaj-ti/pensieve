import type Database from 'better-sqlite3';
import {
  buildFilterClause,
  buildDateClause,
  localDateKey,
  type AnalyticsFilter,
  type DateRange,
} from './shared.js';

export interface FlaggedDirective {
  humanLineNumber: number;
  reason: string;
  createdAt: string;
}

export interface EngagementBreakdown {
  directive: number;
  directiveNecessary: number;
  directiveUnnecessary: number;
  deliberative: number;
  corrective: number;
  acknowledgment: number;
  /** directive + deliberative + corrective — acknowledgment excluded, it's
   * neither babysitting nor engagement, just noise. */
  total: number;
  /** The headline metric: (deliberative + corrective) / directiveUnnecessary.
   * directiveNecessary is excluded from the denominator — a human gating an
   * irreversible action or unblocking a stuck agent isn't a bad pattern.
   * null when there's no directiveUnnecessary turn to divide by (either a
   * perfect session, or too little data — the brief should render this as
   * "no babysitting detected" rather than a bare 0/0). */
  engagementRatio: number | null;
  /** Longest run of consecutive directiveUnnecessary turns — a burst of 5
   * micromanaging turns in a row is a worse pattern than 5 scattered across
   * a whole session, even at the same total count. */
  longestDirectiveBurst: number;
  /** Most recent directiveUnnecessary occurrences, each carrying its
   * concrete "reason" — surfaced directly so a flagged turn is actionable,
   * not just a count. */
  flaggedDirectives: FlaggedDirective[];
}

const FLAGGED_DIRECTIVE_LIMIT = 5;

/**
 * The "am I babysitting or actually collaborating" metric — see
 * EngagementClassification in types.ts. Counts human turns, not insights;
 * a separate axis entirely from getEffortBreakdown (which measures what
 * kind of work the agent's output represents).
 */
export function getEngagementBreakdown(
  db: Database.Database,
  range: DateRange,
  filter?: AnalyticsFilter,
): EngagementBreakdown {
  const { sql: dateSql, params: dateParams } = buildDateClause(range);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT t.classification, t.directive_necessary, t.human_line_number, t.reason, t.created_at
    FROM engagement_turns t
    JOIN episodes e ON t.episode_id = e.id
    WHERE ${dateSql}${filterSql}
    ORDER BY e.start_line ASC, t.human_line_number ASC
  `,
    )
    .all(...dateParams, ...filterParams) as Array<{
    classification: string;
    directive_necessary: number | null;
    human_line_number: number;
    reason: string;
    created_at: string;
  }>;

  let directiveNecessary = 0;
  let directiveUnnecessary = 0;
  let deliberative = 0;
  let corrective = 0;
  let acknowledgment = 0;

  let currentBurst = 0;
  let longestDirectiveBurst = 0;
  const flaggedDirectives: FlaggedDirective[] = [];

  for (const row of rows) {
    if (row.classification === 'directive') {
      if (row.directive_necessary) {
        directiveNecessary++;
        currentBurst = 0;
      } else {
        directiveUnnecessary++;
        currentBurst++;
        longestDirectiveBurst = Math.max(longestDirectiveBurst, currentBurst);
        flaggedDirectives.push({
          humanLineNumber: row.human_line_number,
          reason: row.reason,
          createdAt: row.created_at,
        });
      }
      continue;
    }
    currentBurst = 0;
    if (row.classification === 'deliberative') {
      deliberative++;
    } else if (row.classification === 'corrective') {
      corrective++;
    } else if (row.classification === 'acknowledgment') {
      acknowledgment++;
    }
  }

  const directive = directiveNecessary + directiveUnnecessary;
  const total = directive + deliberative + corrective;
  const goodEngagement = deliberative + corrective;

  return {
    directive,
    directiveNecessary,
    directiveUnnecessary,
    deliberative,
    corrective,
    acknowledgment,
    total,
    engagementRatio: directiveUnnecessary > 0 ? goodEngagement / directiveUnnecessary : null,
    longestDirectiveBurst,
    flaggedDirectives: flaggedDirectives.slice(-FLAGGED_DIRECTIVE_LIMIT).reverse(),
  };
}

export interface EngagementBreakdownTrendPoint extends EngagementBreakdown {
  date: string;
}

/**
 * Per-day time series of the same metrics getEngagementBreakdown computes
 * for a single range — mirrors getEffortBreakdownTrend's shape in
 * effortBreakdown.ts (same days/filter signature, same localDateKey cutoff)
 * so the dashboard can plot "is my babysitting ratio improving" over time,
 * not just a single-range snapshot.
 */
export function getEngagementBreakdownTrend(
  db: Database.Database,
  days: number,
  filter?: AnalyticsFilter,
): EngagementBreakdownTrendPoint[] {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffDate = localDateKey(cutoffMs);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  const rows = db
    .prepare(
      `
    SELECT e.date, t.classification, t.directive_necessary, t.human_line_number, t.reason, t.created_at
    FROM engagement_turns t
    JOIN episodes e ON t.episode_id = e.id
    WHERE e.date >= ?${filterSql}
    ORDER BY e.date ASC, e.start_line ASC, t.human_line_number ASC
  `,
    )
    .all(cutoffDate, ...filterParams) as Array<{
    date: string;
    classification: string;
    directive_necessary: number | null;
    human_line_number: number;
    reason: string;
    created_at: string;
  }>;

  interface DayAccum {
    directiveNecessary: number;
    directiveUnnecessary: number;
    deliberative: number;
    corrective: number;
    acknowledgment: number;
    currentBurst: number;
    longestDirectiveBurst: number;
    flaggedDirectives: FlaggedDirective[];
  }

  const byDate = new Map<string, DayAccum>();
  const dateOrder: string[] = [];

  for (const row of rows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, {
        directiveNecessary: 0,
        directiveUnnecessary: 0,
        deliberative: 0,
        corrective: 0,
        acknowledgment: 0,
        currentBurst: 0,
        longestDirectiveBurst: 0,
        flaggedDirectives: [],
      });
      dateOrder.push(row.date);
    }
    const acc = byDate.get(row.date)!;

    if (row.classification === 'directive') {
      if (row.directive_necessary) {
        acc.directiveNecessary++;
        acc.currentBurst = 0;
      } else {
        acc.directiveUnnecessary++;
        acc.currentBurst++;
        acc.longestDirectiveBurst = Math.max(acc.longestDirectiveBurst, acc.currentBurst);
        acc.flaggedDirectives.push({
          humanLineNumber: row.human_line_number,
          reason: row.reason,
          createdAt: row.created_at,
        });
      }
      continue;
    }
    acc.currentBurst = 0;
    if (row.classification === 'deliberative') {
      acc.deliberative++;
    } else if (row.classification === 'corrective') {
      acc.corrective++;
    } else if (row.classification === 'acknowledgment') {
      acc.acknowledgment++;
    }
  }

  return dateOrder.map((date) => {
    const acc = byDate.get(date)!;
    const directive = acc.directiveNecessary + acc.directiveUnnecessary;
    const total = directive + acc.deliberative + acc.corrective;
    const goodEngagement = acc.deliberative + acc.corrective;

    return {
      date,
      directive,
      directiveNecessary: acc.directiveNecessary,
      directiveUnnecessary: acc.directiveUnnecessary,
      deliberative: acc.deliberative,
      corrective: acc.corrective,
      acknowledgment: acc.acknowledgment,
      total,
      engagementRatio:
        acc.directiveUnnecessary > 0 ? goodEngagement / acc.directiveUnnecessary : null,
      longestDirectiveBurst: acc.longestDirectiveBurst,
      flaggedDirectives: acc.flaggedDirectives.slice(-FLAGGED_DIRECTIVE_LIMIT).reverse(),
    };
  });
}
