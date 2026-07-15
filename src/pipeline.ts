import type Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { openDb } from './db/schema.js';
import { scanNewLines } from './ingest/index.js';
import { advanceCursor } from './ingest/cursor.js';
import { chunkSession } from './chunk/index.js';
import { runExtraction } from './extract/index.js';
import { InsightSchema, type Insight } from './types.js';

export interface PipelineOptions {
  force?: boolean;
  dryRun?: boolean;
  claudeProjectsDir?: string;
  db?: Database.Database;
  client?: Anthropic;
}

export interface PipelineResult {
  sessionsProcessed: number;
  sessionsFailed: number;
  insightsPersisted: number;
  datesTouched: string[];
}

export async function runDailyAnalysis(options: PipelineOptions = {}): Promise<PipelineResult> {
  const config = loadConfig();
  const db = options.db ?? openDb(config.dbPath);
  const client = options.client ?? new Anthropic();

  const scanResults = await scanNewLines(db, {
    claudeProjectsDir: options.claudeProjectsDir,
    force: options.force,
  });

  const result: PipelineResult = {
    sessionsProcessed: 0,
    sessionsFailed: 0,
    insightsPersisted: 0,
    datesTouched: [],
  };

  for (const scanResult of scanResults) {
    try {
      const drafts = chunkSession(scanResult, config);

      if (drafts.length === 0) {
        if (!options.dryRun) {
          advanceCursor(db, scanResult.projectDir, scanResult.sessionId, scanResult.maxLineNumber);
        }
        result.sessionsProcessed++;
        continue;
      }

      // Group drafts by date
      const draftsByDate = new Map<string, typeof drafts>();
      for (const draft of drafts) {
        if (!draftsByDate.has(draft.date)) {
          draftsByDate.set(draft.date, []);
        }
        draftsByDate.get(draft.date)!.push(draft);
      }

      // Collect all data to persist before wrapping in transaction
      interface PersistPlan {
        date: string;
        persistedEpisodes: Array<typeof drafts[0] & { id: number }>;
        insights: Insight[];
      }

      const persistPlans: PersistPlan[] = [];
      let fakeId = -1;

      // Run extraction for all days first (async work)
      for (const [date, dayDrafts] of draftsByDate) {
        const persistedEpisodes: Array<typeof drafts[0] & { id: number }> = [];

        if (!options.dryRun) {
          // In real mode, we'll assign real IDs after insert; use placeholder for now
          for (const draft of dayDrafts) {
            persistedEpisodes.push({
              ...draft,
              id: 0, // Placeholder; will be set during INSERT
            });
          }
        } else {
          // Dry run: fake IDs for extraction to use
          for (const draft of dayDrafts) {
            persistedEpisodes.push({
              ...draft,
              id: fakeId--,
            });
          }
        }

        const insights = await runExtraction(persistedEpisodes, db, client);

        persistPlans.push({
          date,
          persistedEpisodes: dayDrafts.map((d, i) => ({
            ...d,
            id: i, // Temporary placeholder
          })),
          insights,
        });
      }

      // Wrap all DB writes in a single transaction (no async calls inside)
      const sessionInserts = !options.dryRun
        ? db.transaction(() => {
            let totalInserts = 0;
            const insertEpisode = db.prepare(`
              INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
              VALUES (?, ?, ?, ?, ?)
            `);
            const insertInsight = db.prepare(`
              INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const plan of persistPlans) {
              // Insert episodes and capture real IDs
              const episodeIds: number[] = [];
              for (const draft of plan.persistedEpisodes) {
                const info = insertEpisode.run(
                  draft.date,
                  draft.projectDir,
                  draft.sessionId,
                  draft.startLine,
                  draft.endLine,
                );
                episodeIds.push(info.lastInsertRowid as number);
              }

              // Insert insights with real episode IDs
              for (let i = 0; i < plan.insights.length; i++) {
                const insight = plan.insights[i];
                const validated = InsightSchema.parse(insight);
                insertInsight.run(
                  episodeIds[i % episodeIds.length] || 0, // Map to episode; cycle if needed
                  validated.category,
                  validated.text,
                  validated.evidenceRef,
                  validated.significanceScore,
                  validated.verifiedByGit,
                  validated.recurrenceOf,
                  validated.createdAt,
                );
                totalInserts++;
              }

              if (!result.datesTouched.includes(plan.date)) {
                result.datesTouched.push(plan.date);
              }
            }

            return totalInserts;
          })()
        : persistPlans.reduce((sum, plan) => sum + plan.insights.length, 0);

      result.insightsPersisted += sessionInserts;

      // Track dates for dry-run
      if (options.dryRun) {
        for (const plan of persistPlans) {
          if (!result.datesTouched.includes(plan.date)) {
            result.datesTouched.push(plan.date);
          }
        }
      }

      // Only advance cursor after successful persistence
      if (!options.dryRun) {
        advanceCursor(db, scanResult.projectDir, scanResult.sessionId, scanResult.maxLineNumber);
      }

      result.sessionsProcessed++;
    } catch (error) {
      console.error(
        `Error processing session ${scanResult.projectDir}/${scanResult.sessionId}:`,
        error instanceof Error ? error.message : String(error),
      );
      result.sessionsFailed++;
    }
  }

  return result;
}
