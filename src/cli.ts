#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { openDb } from './db/schema.js';
import { runDailyAnalysis } from './pipeline.js';
import { writeBrief } from './brief.js';
import { localDateKey } from './chunk/episodes.js';
import { startDashboardServer } from './dashboard/server.js';

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
      console.log(
        `[dry-run] Processed ${result.sessionsProcessed} ${pluralSession}, ` +
          `${result.insightsPersisted} ${pluralInsight}, ` +
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

program
  .command('dashboard')
  .description('Start a local web dashboard for browsing analytics.')
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
      console.log(`Dashboard running at http://localhost:${port}`);
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
