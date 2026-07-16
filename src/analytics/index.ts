import type Database from 'better-sqlite3';
import { Insight, InsightSchema } from '../types.js';

export interface CategoryTrendPoint {
  date: string;
  category: string;
  count: number;
}

export interface TopInsight extends Insight {
  projectDir: string;
}

export interface RecurrenceChain {
  rootId: number;
  insights: Insight[];
  span: { firstDate: string; lastDate: string };
}

export interface ProjectRollup {
  projectDir: string;
  insightCount: number;
}

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

export interface AnalyticsSnapshot {
  categoryTrend: CategoryTrendPoint[];
  topInsights: TopInsight[];
  recurrenceChains: RecurrenceChain[];
  crossProjectRollup: ProjectRollup[];
  effortBreakdown: EffortBreakdown;
}

function localDateKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

export function getRecurrenceChains(db: Database.Database, days: number): RecurrenceChain[] {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffDate = localDateKey(cutoffMs);

  // Fetch all insights in the window
  const insightsInWindow = db
    .prepare(
      `
    SELECT
      i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
      i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at, e.date
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date >= ?
  `,
    )
    .all(cutoffDate) as Array<{
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
    date: string;
  }>;

  // Build a map of all insights for chain following
  const insightMap = new Map<number, (typeof insightsInWindow)[0]>();
  const recurrenceMap = new Map<number, number>();

  for (const insight of insightsInWindow) {
    insightMap.set(insight.id, insight);
    if (insight.recurrence_of !== null) {
      recurrenceMap.set(insight.id, insight.recurrence_of);
    }
  }

  // Build chains: walk from each insight to root, collecting full ancestor paths
  const chains = new Map<number, number[]>(); // root id -> [root, ...descendants in order]
  const processed = new Set<number>(); // insights we've already processed

  for (const insight of insightsInWindow) {
    if (processed.has(insight.id)) continue;

    // Walk from this insight to its root, collecting the full path
    // Use per-walk visited set to detect cycles
    let current = insight.id;
    const path: number[] = [];
    const visitedInWalk = new Set<number>(); // Cycle detection for this walk
    let rootId: number | null = null;

    while (true) {
      // Detect cycle: if we've seen this insight in this walk, it's cyclic
      if (visitedInWalk.has(current)) {
        // Cyclic linkage detected: don't add cycle point again, treat as broken chain
        // Current chain from insight to the cycle point is invalid; skip it
        rootId = null;
        break;
      }
      visitedInWalk.add(current);

      // Load insight if not in map
      if (!insightMap.has(current)) {
        const row = db
          .prepare(
            `
          SELECT
            i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
            i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at, e.date
          FROM insights i
          JOIN episodes e ON i.episode_id = e.id
          WHERE i.id = ?
        `,
          )
          .get(current) as (typeof insightsInWindow)[0] | undefined;

        if (!row) {
          // Not found, treat current as root
          rootId = current;
          path.push(current);
          break;
        }
        insightMap.set(current, row);
      }

      const ins = insightMap.get(current)!;
      path.push(current);

      if (ins.recurrence_of === null) {
        // Found root
        rootId = current;
        break;
      }

      current = ins.recurrence_of;
    }

    if (rootId !== null) {
      // Reverse path so it's root-first, then add to chains
      const fullPath = [...path].reverse();
      if (!chains.has(rootId)) {
        chains.set(rootId, fullPath);
      } else {
        // Merge with existing chain, ensuring no duplicates
        const existing = chains.get(rootId)!;
        for (const id of fullPath) {
          if (!existing.includes(id)) {
            existing.push(id);
          }
        }
      }

      // Mark all insights in this chain as processed
      for (const id of fullPath) {
        processed.add(id);
      }
    }
  }

  // Build RecurrenceChain objects for chains with length > 1
  const result: RecurrenceChain[] = [];

  for (const [rootId, chainIds] of chains.entries()) {
    if (chainIds.length <= 1) continue;

    // Map all chain IDs to Insights, loading any outside the window if needed
    const allChainInsights = chainIds
      .map((id) => {
        let row = insightMap.get(id);
        if (!row) {
          // Load from DB if outside window
          row = db
            .prepare(
              `
            SELECT
              i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
              i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at, e.date
            FROM insights i
            JOIN episodes e ON i.episode_id = e.id
            WHERE i.id = ?
          `,
            )
            .get(id) as (typeof insightsInWindow)[0] | undefined;
          if (!row) return null;
        }
        return InsightSchema.parse({
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
      })
      .filter((i) => i !== null) as Insight[];

    if (allChainInsights.length > 1) {
      // Sort insights by createdAt (chronological root-first order)
      const sorted = [...allChainInsights].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      // Determine span from earliest and latest
      const firstInsight = sorted[0];
      const lastInsight = sorted[sorted.length - 1];
      const firstDate = insightMap.get(firstInsight?.id || 0)?.date || '';
      const lastDate = insightMap.get(lastInsight?.id || 0)?.date || '';

      result.push({
        rootId,
        insights: sorted,
        span: { firstDate, lastDate },
      });
    }
  }

  return result.sort((a, b) => b.insights.length - a.insights.length);
}

/**
 * The "how much of this was donkey work" metric: what fraction of a day's
 * insights came from toil (mechanical/repetitive work that shouldn't have
 * needed a human more than once) versus judgment (real skilled reasoning)
 * versus overhead (necessary but zero-signal cost). Counts insights, not
 * time — a duration-weighted version (using episode line-spans) is a
 * natural follow-up once this is validated as useful.
 */
export function getEffortBreakdown(db: Database.Database, date: string): EffortBreakdown {
  const rows = db
    .prepare(
      `
    SELECT i.effort_class, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date = ?
    GROUP BY i.effort_class
  `,
    )
    .all(date) as Array<{ effort_class: string; count: number }>;

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

export function getCrossProjectRollup(db: Database.Database, date: string): ProjectRollup[] {
  const rows = db
    .prepare(
      `
    SELECT e.project_dir, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date = ?
    GROUP BY e.project_dir
    ORDER BY count DESC
  `,
    )
    .all(date) as Array<{
    project_dir: string;
    count: number;
  }>;

  return rows.map((row) => ({
    projectDir: row.project_dir,
    insightCount: row.count,
  }));
}

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

export function getEffortBreakdownTrend(
  db: Database.Database,
  days: number,
): EffortBreakdownTrendPoint[] {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffDate = localDateKey(cutoffMs);

  const rows = db
    .prepare(
      `
    SELECT e.date, i.effort_class, COUNT(*) as count
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date >= ?
    GROUP BY e.date, i.effort_class
    ORDER BY e.date ASC
  `,
    )
    .all(cutoffDate) as Array<{
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
