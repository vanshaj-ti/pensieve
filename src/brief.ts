import type Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/schema.js';
import { Insight, InsightSchema, InsightCategory } from './types.js';
import {
  getTopInsights,
  getRecurrenceChains,
  getCrossProjectRollup,
  getEffortBreakdown,
  type TopInsight,
  type RecurrenceChain,
  type ProjectRollup,
  type EffortBreakdown,
} from './analytics/index.js';

export interface BriefOptions {
  db: Database.Database;
  date: string;
  briefsDir: string;
}

const CATEGORY_ORDER: InsightCategory[] = [
  'strategic_value',
  'decision_record',
  'friction_audit',
  'high_potential_seeds',
  'ai_leverage',
  'ai_correction_load',
];

const CATEGORY_HEADERS: Record<InsightCategory, string> = {
  strategic_value: 'Strategic Value',
  decision_record: 'Decision Record',
  friction_audit: 'Friction Audit',
  high_potential_seeds: 'High-Potential Seeds',
  ai_leverage: 'AI Leverage',
  ai_correction_load: 'AI Correction Load',
};

interface InsightWithRecurrenceDate extends Insight {
  recurrenceDate?: string;
}

export function renderBriefMarkdown(
  insights: InsightWithRecurrenceDate[],
  date: string,
  topInsights: TopInsight[] = [],
  recurrenceChains: RecurrenceChain[] = [],
  crossProjectRollup: ProjectRollup[] = [],
  effortBreakdown?: EffortBreakdown,
): string {
  const lines: string[] = [`# Pensieve Brief — ${date}\n`];

  if (effortBreakdown && effortBreakdown.total > 0) {
    const pct = (r: number) => `${Math.round(r * 100)}%`;
    lines.push(`## Effort Breakdown\n`);
    lines.push(
      `${pct(effortBreakdown.judgmentRatio)} judgment, ${pct(effortBreakdown.toilRatio)} toil, ${pct(effortBreakdown.overheadRatio)} overhead (${effortBreakdown.total} insights today)`,
    );
    lines.push('');
  }

  if (topInsights.length > 0) {
    lines.push(`## Top Insights Today\n`);
    topInsights.forEach((insight, idx) => {
      let bullet = `${idx + 1}. ${insight.text}`;
      if (insight.evidenceRef) {
        bullet += ` _(${insight.evidenceRef})_`;
      }
      bullet += ` [${insight.significanceScore.toFixed(1)}]`;
      lines.push(bullet);
    });
    lines.push('');
  }

  if (recurrenceChains.length > 0) {
    lines.push(`## Recurring Patterns\n`);
    recurrenceChains.forEach((chain) => {
      const firstDate = new Date(chain.span.firstDate);
      const lastDate = new Date(chain.span.lastDate);
      const elapsedDays = Math.floor(
        (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const bullet = `- ${chain.insights[0]!.text} — recurred ${chain.insights.length} times over ${elapsedDays} days (first seen ${chain.span.firstDate})`;
      lines.push(bullet);
    });
    lines.push('');
  }

  if (crossProjectRollup.length > 1) {
    lines.push(`## By Project\n`);
    crossProjectRollup.forEach((rollup) => {
      lines.push(`- ${rollup.projectDir}: ${rollup.insightCount} insights`);
    });
    lines.push('');
  }

  const grouped = new Map<InsightCategory, InsightWithRecurrenceDate[]>();

  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, []);
  }

  for (const insight of insights) {
    const cat = insight.category;
    if (!grouped.has(cat)) {
      grouped.set(cat, []);
    }
    grouped.get(cat)!.push(insight);
  }

  for (const cat of CATEGORY_ORDER) {
    const catInsights = grouped.get(cat)!;
    if (catInsights.length === 0) {
      continue;
    }

    lines.push(`## ${CATEGORY_HEADERS[cat]}\n`);

    for (const insight of catInsights) {
      let bullet = `- ${insight.text}`;
      if (insight.evidenceRef) {
        bullet += ` _(${insight.evidenceRef})_`;
      }
      bullet += ` [${insight.significanceScore.toFixed(1)}]`;

      if (insight.verifiedByGit) {
        bullet += ` ✓ (verified)`;
      }

      if (insight.recurrenceOf && insight.recurrenceDate) {
        bullet += ` (recurring — also seen on ${insight.recurrenceDate})`;
      } else if (insight.recurrenceOf) {
        bullet += ` (recurring)`;
      }

      lines.push(bullet);
    }

    lines.push('');
  }

  return lines.join('\n');
}

export function writeBrief(options: BriefOptions): { path: string; insightCount: number } {
  const config = loadConfig();
  const { db: providedDb, date, briefsDir } = options;
  const db = providedDb ?? openDb(config.dbPath);

  // Query insights for the given date by joining through episodes
  const rows = db
    .prepare(
      `
    SELECT
      i.id, i.episode_id, i.category, i.text, i.evidence_ref, i.significance_score,
      i.effort_class, i.verified_by_git, i.recurrence_of, i.created_at
    FROM insights i
    JOIN episodes e ON i.episode_id = e.id
    WHERE e.date = ?
    ORDER BY i.category, i.significance_score DESC
  `,
    )
    .all(date) as Array<{
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
  }>;

  // Create a helper to get recurrence insight dates
  const insightDateCache = new Map<number, string>();
  const getInsightDateWithCache = (insightId: number): string | null => {
    if (insightDateCache.has(insightId)) {
      return insightDateCache.get(insightId)!;
    }
    const row = db
      .prepare(
        'SELECT e.date FROM insights i JOIN episodes e ON i.episode_id = e.id WHERE i.id = ?',
      )
      .get(insightId) as { date: string } | undefined;
    if (row) {
      insightDateCache.set(insightId, row.date);
      return row.date;
    }
    return null;
  };

  // Convert and validate insights, then attach recurrence dates
  const insightsWithDates: InsightWithRecurrenceDate[] = rows.map((row) => {
    const validated = InsightSchema.parse({
      id: row.id,
      episodeId: row.episode_id,
      category: row.category,
      text: row.text,
      evidenceRef: row.evidence_ref,
      significanceScore: row.significance_score,
      effortClass: row.effort_class,
      verifiedByGit: row.verified_by_git ? true : null, // SQLite returns 1/0/null as number/null
      recurrenceOf: row.recurrence_of,
      createdAt: row.created_at,
    });
    const recDate = row.recurrence_of ? getInsightDateWithCache(row.recurrence_of) : undefined;
    return { ...validated, recurrenceDate: recDate || undefined };
  });

  // Fetch analytics data
  const topInsights = getTopInsights(db, date, 5);
  const recurrenceChains = getRecurrenceChains(db, 30);
  const crossProjectRollup = getCrossProjectRollup(db, date);
  const effortBreakdown = getEffortBreakdown(db, date);

  const markdown = renderBriefMarkdown(
    insightsWithDates,
    date,
    topInsights,
    recurrenceChains,
    crossProjectRollup,
    effortBreakdown,
  );

  // Create directory and write file
  mkdirSync(briefsDir, { recursive: true });

  const filePath = join(briefsDir, `${date}.md`);
  writeFileSync(filePath, markdown);

  return {
    path: filePath,
    insightCount: insightsWithDates.length,
  };
}
