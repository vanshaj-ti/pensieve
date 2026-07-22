#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { openDb } from './db/schema.js';
import { runDailyAnalysis } from './pipeline.js';
import { writeBrief } from './brief.js';
import { localDateKey } from './chunk/episodes.js';
import { startDashboardServer } from './dashboard/server.js';
import { deriveSessionInsights } from './synthesis.js';
import { getWorkItemsForRun, insertDerivedInsights } from './analytics/derivedInsights.js';

const program = new Command();

program
  .name('pensieve')
  .description('Mines Claude Code session transcripts for daily insight briefs.');

export interface AnalyzeCommandOptions {
  force?: boolean;
  date?: string;
  dryRun?: boolean;
  project?: string;
  session?: string;
  label?: string;
}

export async function runAnalyzeCommand(opts: AnalyzeCommandOptions): Promise<void> {
  try {
    const config = loadConfig();

    const result = await runDailyAnalysis({
      force: opts.force,
      dryRun: opts.dryRun,
      projectFilter: opts.project,
      sessionFilter: opts.session,
      label: opts.label,
    });

    // Determine which dates to write briefs for
    const briefDates = new Set<string>();

    if (opts.date) {
      // Use only specified date (no additional dates)
      briefDates.add(opts.date);
    } else {
      // Use today + any dates from datesTouched
      const today = localDateKey(new Date());
      briefDates.add(today);
      for (const date of result.datesTouched) {
        briefDates.add(date);
      }
    }

    const briefPaths: string[] = [];

    if (!opts.dryRun) {
      const db = openDb(config.dbPath);
      try {
        for (const date of Array.from(briefDates).sort()) {
          const { path } = await writeBrief({
            db,
            date,
            briefsDir: config.briefsDir,
          });
          briefPaths.push(path);
        }
      } finally {
        db.close();
      }
    }

    // Format summary
    const pluralSession = result.sessionsProcessed === 1 ? 'session' : 'sessions';
    const pluralInsight = result.insightsPersisted === 1 ? 'insight' : 'insights';

    if (opts.dryRun) {
      const wouldWrite = Array.from(briefDates).sort().join(', ');
      const pluralEpisode = result.episodesFound === 1 ? 'episode' : 'episodes';
      console.log(
        `[dry-run] Would process ${result.sessionsProcessed} ${pluralSession} ` +
          `covering ${result.episodesFound} ${pluralEpisode}, insights not computed in dry-run mode; ` +
          `would write brief(s) for: ${wouldWrite}`,
      );
    } else if (briefPaths.length > 0) {
      const briefList = briefPaths.join(', ');
      console.log(
        `Processed ${result.sessionsProcessed} ${pluralSession}, ` +
          `${result.insightsPersisted} ${pluralInsight}, ` +
          `brief(s) written to ${briefList}`,
      );
    } else {
      console.log(
        `Processed ${result.sessionsProcessed} ${pluralSession}, ${result.insightsPersisted} ${pluralInsight}`,
      );
    }

    if (result.sessionsFailed > 0) {
      console.warn(`Warning: ${result.sessionsFailed} session(s) failed and were skipped`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

program
  .command('analyze')
  .description("Run the ingestion/extraction pipeline and update today's brief.")
  .option('--force', 'Bypass cursor checks for backfill')
  .option('--date <YYYY-MM-DD>', 'Analyze/write brief for a specific past day')
  .option('--dry-run', 'Run extraction without persisting or advancing cursor')
  .option(
    '--project <projectDir>',
    'Scope to one project (sanitized dir name under ~/.claude/projects/)',
  )
  .option('--session <sessionId>', 'Scope to one session within --project (filename minus .jsonl)')
  .option('--label <name>', 'Tag this run with a label (auto-generated if omitted)')
  .action(async (opts: AnalyzeCommandOptions) => {
    await runAnalyzeCommand(opts);
  });

export interface DeriveInsightsCommandOptions {
  project: string;
  session: string;
  label: string;
}

export async function runDeriveInsightsCommand(opts: DeriveInsightsCommandOptions): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const workItems = getWorkItemsForRun(db, opts.project, opts.session, opts.label);
    const derived = await deriveSessionInsights({
      projectDir: opts.project,
      sessionId: opts.session,
      label: opts.label,
      workItems,
    });
    insertDerivedInsights(db, derived);
    const plural = derived.length === 1 ? 'insight' : 'insights';
    console.log(`Derived ${derived.length} ${plural} from ${workItems.length} work item(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

program
  .command('derive-insights')
  .description(
    'Synthesize win/struggle/learning/risk insights from a run’s existing work items (the same second-order pass the dashboard triggers after analyze).',
  )
  .requiredOption('--project <projectDir>', 'Sanitized project dir name under ~/.claude/projects/')
  .requiredOption('--session <sessionId>', 'Session id (filename minus .jsonl)')
  .requiredOption('--label <name>', 'The analyze run’s label to derive insights for')
  .action(async (opts: DeriveInsightsCommandOptions) => {
    await runDeriveInsightsCommand(opts);
  });

program
  .command('dashboard')
  .description(
    'Start the dashboard API server (view the UI separately via `npm run dev:dashboard`).',
  )
  .option('--port <number>', 'Port to listen on', '4200')
  .option('--db <path>', 'Override the database path')
  .action((opts: { port: string; db?: string }) => {
    try {
      const config = loadConfig(opts.db ? { dbPath: opts.db } : {});
      const port = Number(opts.port);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('Error: port must be a valid number between 1 and 65535');
        process.exitCode = 1;
        return;
      }
      startDashboardServer(config, port);
      console.log(
        `Dashboard API running at http://localhost:${port} — run \`npm run dev:dashboard\` to view the UI.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

// Only parse if this is the main entry point (not imported in tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}
