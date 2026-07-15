import type Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { openDb } from './db/schema.js';
import { scanNewLines } from './ingest/index.js';
import { advanceCursor } from './ingest/cursor.js';
import { chunkSession } from './chunk/index.js';
import { runExtraction } from './extract/index.js';
import { InsightSchema } from './types.js';

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

      let sessionInserts = 0;

      // Process each day
      for (const [date, dayDrafts] of draftsByDate) {
        const persistedEpisodes: Array<typeof drafts[0] & { id: number }> = [];

        if (!options.dryRun) {
          // Insert episodes and get IDs
          const insertEpisode = db.prepare(`
            INSERT INTO episodes (date, project_dir, session_id, start_line, end_line)
            VALUES (?, ?, ?, ?, ?)
          `);

          for (const draft of dayDrafts) {
            const info = insertEpisode.run(
              draft.date,
              draft.projectDir,
              draft.sessionId,
              draft.startLine,
              draft.endLine,
            );
            persistedEpisodes.push({
              ...draft,
              id: info.lastInsertRowid as number,
            });
          }
        } else {
          // Dry run: fake sequential negative IDs
          let fakeId = -1;
          for (const draft of dayDrafts) {
            persistedEpisodes.push({
              ...draft,
              id: fakeId--,
            });
          }
        }

        // Run extraction
        const insights = await runExtraction(persistedEpisodes, db, client);

        if (!options.dryRun && insights.length > 0) {
          // Validate and persist insights in a transaction
          db.transaction(() => {
            const insertInsight = db.prepare(`
              INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const insight of insights) {
              const validated = InsightSchema.parse(insight);
              insertInsight.run(
                validated.episodeId,
                validated.category,
                validated.text,
                validated.evidenceRef,
                validated.significanceScore,
                validated.verifiedByGit,
                validated.recurrenceOf,
                validated.createdAt,
              );
              sessionInserts++;
            }
          })();
        } else if (options.dryRun) {
          sessionInserts += insights.length;
        }

        if (!result.datesTouched.includes(date)) {
          result.datesTouched.push(date);
        }
      }

      result.insightsPersisted += sessionInserts;

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
