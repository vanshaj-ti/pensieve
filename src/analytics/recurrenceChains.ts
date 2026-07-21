import type Database from 'better-sqlite3';
import { Insight, InsightSchema } from '../types.js';
import { localDateKey, buildFilterClause, type AnalyticsFilter } from './shared.js';

export interface RecurrenceChain {
  rootId: number;
  insights: Insight[];
  span: { firstDate: string; lastDate: string };
}

type InsightRow = {
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
};

export function resolveInsight(
  db: Database.Database,
  insightMap: Map<number, InsightRow>,
  id: number,
): InsightRow | undefined {
  let row = insightMap.get(id);
  if (row) {
    return row;
  }

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
    .get(id) as InsightRow | undefined;

  if (row) {
    insightMap.set(id, row);
  }

  return row;
}

export function getRecurrenceChains(
  db: Database.Database,
  days: number,
  filter?: AnalyticsFilter,
): RecurrenceChain[] {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffDate = localDateKey(cutoffMs);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filter);

  // Fetch all insights in the window
  const insightsInWindow = db
    .prepare(
      `
    SELECT
      i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
      i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at, e.date
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date >= ?${filterSql}
  `,
    )
    .all(cutoffDate, ...filterParams) as Array<{
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
  const insightMap = new Map<number, InsightRow>();
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
      const row = resolveInsight(db, insightMap, current);
      if (!row) {
        // Not found, treat current as root
        rootId = current;
        path.push(current);
        break;
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
        const row = resolveInsight(db, insightMap, id);
        if (!row) return null;
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
