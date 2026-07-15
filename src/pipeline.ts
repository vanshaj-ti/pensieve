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

      // Collect extraction results and episode mappings before transaction
      interface ExtractedDay {
        date: string;
        drafts: typeof drafts;
        episodeToInsights: Map<number, Insight[]>; // Map temp episode ID to its insights
      }

      const extractedDays: ExtractedDay[] = [];

      // Run extraction for all days (async work outside transaction)
      for (const [date, dayDrafts] of draftsByDate) {
        // Build persisted episodes with temp IDs (index)
        const persistedEpisodes = dayDrafts.map((draft, index) => ({
          ...draft,
          id: index,
        }));

        // Extract all episodes together
        const allInsights = await runExtraction(persistedEpisodes, db, client);

        // Group insights by their episode ID (which is the temp index)
        const episodeToInsights = new Map<number, Insight[]>();
        for (const insight of allInsights) {
          const episodeId = insight.episodeId;
          if (!episodeToInsights.has(episodeId)) {
            episodeToInsights.set(episodeId, []);
          }
          episodeToInsights.get(episodeId)!.push(insight);
        }

        extractedDays.push({
          date,
          drafts: dayDrafts,
          episodeToInsights,
        });
      }

      // Wrap all DB writes in a single transaction
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

            for (const day of extractedDays) {
              // Insert all episodes and map temp IDs to real IDs
              const tempToRealId = new Map<number, number>();
              for (let tempId = 0; tempId < day.drafts.length; tempId++) {
                const draft = day.drafts[tempId];
                const info = insertEpisode.run(
                  draft.date,
                  draft.projectDir,
                  draft.sessionId,
                  draft.startLine,
                  draft.endLine,
                );
                tempToRealId.set(tempId, info.lastInsertRowid as number);
              }

              // Insert insights using correct real episode IDs
              for (const [tempEpisodeId, insights] of day.episodeToInsights) {
                const realEpisodeId = tempToRealId.get(tempEpisodeId) ?? 0;
                for (const insight of insights) {
                  const validated = InsightSchema.parse(insight);
                  insertInsight.run(
                    realEpisodeId,
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
              }

              if (!result.datesTouched.includes(day.date)) {
                result.datesTouched.push(day.date);
              }
            }

            return totalInserts;
          })()
        : extractedDays.reduce((sum, day) => {
            let daySum = 0;
            for (const insights of day.episodeToInsights.values()) {
              daySum += insights.length;
            }
            return sum + daySum;
          }, 0);

      result.insightsPersisted += sessionInserts;

      // Track dates for dry-run
      if (options.dryRun) {
        for (const day of extractedDays) {
          if (!result.datesTouched.includes(day.date)) {
            result.datesTouched.push(day.date);
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
