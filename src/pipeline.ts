import type Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { openDb, packEmbedding } from './db/schema.js';
import { scanNewLines } from './ingest/index.js';
import { advanceCursor } from './ingest/cursor.js';
import { chunkSession } from './chunk/index.js';
import { runExtraction } from './extract/index.js';
import { applyEmbeddingRecurrence, type InsightWithEmbedding } from './extract/recurrence.js';
import { InsightSchema } from './types.js';

export interface PipelineOptions {
  force?: boolean;
  dryRun?: boolean;
  claudeProjectsDir?: string;
  db?: Database.Database;
  client?: Anthropic;
  /** Scope ingestion to one project (see ScanOptions.projectFilter). */
  projectFilter?: string;
  /** Scope ingestion to one session within projectFilter (see ScanOptions.sessionFilter). */
  sessionFilter?: string;
  /** Tags every episode inserted by this run. Auto-generated (run-<timestamp>) if omitted. */
  label?: string;
}

function defaultRunLabel(): string {
  return `run-${new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}`;
}

export interface PipelineResult {
  sessionsProcessed: number;
  sessionsFailed: number;
  insightsPersisted: number;
  episodesFound: number;
  datesTouched: string[];
  label: string;
}

export async function runDailyAnalysis(options: PipelineOptions = {}): Promise<PipelineResult> {
  const config = loadConfig();
  const db = options.db ?? openDb(config.dbPath);
  // Explicitly pin apiKey + baseURL rather than letting the SDK read
  // ANTHROPIC_BASE_URL / ANTHROPIC_CUSTOM_HEADERS from the ambient
  // environment. This machine's shell sets those globally (for Claude Code's
  // own proxy setup), which silently redirected every real API call to that
  // proxy with the wrong auth scheme — a bare sk-ant-... key doesn't satisfy
  // the proxy's expected header, producing a 401 that looked like a bad key
  // but was actually a request going to the wrong endpoint entirely.
  const client =
    options.client ??
    new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com',
    });

  const label = options.label ?? defaultRunLabel();

  const scanResults = await scanNewLines(db, {
    claudeProjectsDir: options.claudeProjectsDir,
    force: options.force,
    projectFilter: options.projectFilter,
    sessionFilter: options.sessionFilter,
  });

  const result: PipelineResult = {
    sessionsProcessed: 0,
    sessionsFailed: 0,
    insightsPersisted: 0,
    episodesFound: 0,
    datesTouched: [],
    label,
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

      // Track episode count and dates unconditionally
      result.episodesFound += drafts.length;
      for (const date of draftsByDate.keys()) {
        if (!result.datesTouched.includes(date)) {
          result.datesTouched.push(date);
        }
      }

      // Process each date-batch independently: extract → persist → advance cursor.
      // This granularity (date-batch, not per-episode) balances two concerns:
      // (1) Sonnet's extraction pools episodes within a date for duplicate-merging
      //     and shared context — calling runExtraction per-date preserves that behavior.
      // (2) A failure in one date's extraction no longer discards already-succeeded dates —
      //     each date's transaction commits independently, and the cursor advances past it
      //     before the next date is even attempted.
      // A separate, parallel fix (Sonnet's per-batch error handling) handles error isolation
      // within extraction's verify/score step, making them complementary for bounded recovery.
      let dayFailedEarly = false;

      for (const [date, dayDrafts] of draftsByDate) {
        try {
          // Build persisted episodes with temp IDs (index)
          const persistedEpisodes = dayDrafts.map((draft, index) => ({
            ...draft,
            id: index,
          }));

          // Extract all episodes in this date batch together
          const allInsights = await runExtraction(persistedEpisodes, db, client);

          // Apply embedding-based recurrence detection
          const insightsWithEmbeddings = await applyEmbeddingRecurrence(allInsights, db, config);

          // Group insights by their episode ID (which is the temp index)
          const episodeToInsights = new Map<number, InsightWithEmbedding[]>();
          for (const item of insightsWithEmbeddings) {
            const episodeId = item.insight.episodeId;
            if (!episodeToInsights.has(episodeId)) {
              episodeToInsights.set(episodeId, []);
            }
            episodeToInsights.get(episodeId)!.push(item);
          }

          // Commit this date's episodes + insights in its own transaction
          if (!options.dryRun) {
            const dayInserts = db.transaction(() => {
              let totalInserts = 0;
              const insertEpisode = db.prepare(`
                INSERT INTO episodes (date, project_dir, session_id, start_line, end_line, label)
                VALUES (?, ?, ?, ?, ?, ?)
              `);
              const insertInsight = db.prepare(`
                INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, effort_class, verified_by_git, recurrence_of, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);
              const insertEmbedding = db.prepare(`
                INSERT INTO insight_embeddings (insight_id, embedding, model, created_at)
                VALUES (?, ?, ?, ?)
              `);

              // Insert all episodes and map temp IDs to real IDs
              const tempToRealId = new Map<number, number>();
              for (let tempId = 0; tempId < dayDrafts.length; tempId++) {
                const draft = dayDrafts[tempId];
                const info = insertEpisode.run(
                  draft.date,
                  draft.projectDir,
                  draft.sessionId,
                  draft.startLine,
                  draft.endLine,
                  label,
                );
                tempToRealId.set(tempId, info.lastInsertRowid as number);
                totalInserts++;
              }

              // Insert insights using correct real episode IDs
              for (const [tempEpisodeId, insightsWithEmbeddings] of episodeToInsights) {
                const realEpisodeId = tempToRealId.get(tempEpisodeId) ?? 0;
                for (const { insight, embedding } of insightsWithEmbeddings) {
                  const validated = InsightSchema.parse(insight);
                  const info = insertInsight.run(
                    realEpisodeId,
                    validated.category,
                    validated.text,
                    validated.evidenceRef,
                    validated.significanceScore,
                    validated.effortClass,
                    validated.verifiedByGit,
                    validated.recurrenceOf,
                    validated.createdAt,
                  );
                  totalInserts++;

                  if (embedding !== null) {
                    insertEmbedding.run(
                      info.lastInsertRowid as number,
                      packEmbedding(embedding),
                      config.embeddingsModel,
                      validated.createdAt,
                    );
                  }
                }
              }

              return totalInserts;
            })();

            result.insightsPersisted += dayInserts;

            // Advance cursor past this date's max line
            const dateMaxLine = Math.max(...dayDrafts.map((d) => d.endLine));
            advanceCursor(db, scanResult.projectDir, scanResult.sessionId, dateMaxLine);
          }
        } catch (dayError) {
          console.error(
            `Error processing date ${date} in session ${scanResult.sessionId}: ${dayError}`,
          );
          dayFailedEarly = true;
          break;
        }
      }

      if (dayFailedEarly) {
        result.sessionsFailed++;
      } else {
        result.sessionsProcessed++;
      }
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
