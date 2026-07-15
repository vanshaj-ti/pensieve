import type Database from 'better-sqlite3';
import { listSessionFiles, needsScan } from './scanner.js';
import { parseSessionLines } from './parser.js';
import { getLastRunAt, effectiveStartLine } from './cursor.js';
import type { ParsedLine } from './parser.js';

export interface ScanResult {
  projectDir: string;
  sessionId: string;
  filePath: string;
  lines: ParsedLine[];
  maxLineNumber: number;
}

export interface ScanOptions {
  claudeProjectsDir?: string;
  force?: boolean;
  /** Only scan sessions whose projectDir exactly matches this value.
   * Scoping filter, not a search — used for debugging/backfill against one
   * project instead of the full sweep across every Claude Code project. */
  projectFilter?: string;
  /** Only scan the session with this exact sessionId (filename minus .jsonl).
   * Combine with projectFilter to scope to one specific session file. */
  sessionFilter?: string;
}

export async function scanNewLines(
  db: Database.Database,
  options: ScanOptions = {},
): Promise<ScanResult[]> {
  const sessionFiles = listSessionFiles(options.claudeProjectsDir);
  const results: ScanResult[] = [];

  for (const { projectDir, sessionId, filePath } of sessionFiles) {
    if (options.projectFilter && projectDir !== options.projectFilter) {
      continue;
    }
    if (options.sessionFilter && sessionId !== options.sessionFilter) {
      continue;
    }
    const lastRunAt = getLastRunAt(db, projectDir, sessionId);

    if (!options.force && !needsScan(filePath, lastRunAt)) {
      continue;
    }

    const startLine = effectiveStartLine(db, projectDir, sessionId, options.force);
    const { lines, maxLineNumber } = await parseSessionLines(filePath, startLine);

    if (lines.length > 0 || maxLineNumber > startLine) {
      results.push({
        projectDir,
        sessionId,
        filePath,
        lines,
        maxLineNumber,
      });
    }
  }

  return results;
}

// TODO: run 3 will add episode chunking here; run 4 will add Haiku/Sonnet extraction.
// run 5 will wire scanNewLines + advanceCursor into the CLI analyze command.
