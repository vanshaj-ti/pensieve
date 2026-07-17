import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SessionFile {
  projectDir: string;
  sessionId: string;
  filePath: string;
}

export function listSessionFiles(claudeProjectsDir?: string): SessionFile[] {
  const root = claudeProjectsDir || join(homedir(), '.claude', 'projects');
  const files: SessionFile[] = [];

  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    const projectPath = join(root, projectDir);
    let stat;
    try {
      stat = statSync(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }

    let jsonlFiles: string[] = [];
    try {
      jsonlFiles = readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const fileName of jsonlFiles) {
      if (!fileName.endsWith('.jsonl')) {
        continue;
      }
      const filePath = join(projectPath, fileName);
      const sessionId = fileName.slice(0, -6);
      files.push({ projectDir, sessionId, filePath });
    }
  }

  return files;
}

export interface SessionMetadata {
  cwd: string | null;
  title: string | null;
}

/**
 * Best-effort display metadata for one session, read directly from its
 * JSONL (not surfaced by listSessionFiles/needsScan, which the real pipeline
 * scan uses and must stay cheap — this is dashboard-only, display-only).
 * `cwd` is the real filesystem path Claude Code recorded for the session
 * (nicer than the sanitized project-dir name). `title` is the last
 * non-empty `aiTitle` line in the file (an auto-generated session title
 * that gets refined as the session progresses — the last value is the
 * most complete). Malformed lines are skipped, never thrown.
 */
export function readSessionMetadata(filePath: string): SessionMetadata {
  let cwd: string | null = null;
  let title: string | null = null;

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return { cwd, title };
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj.cwd === 'string' && obj.cwd) {
      cwd = obj.cwd;
    }
    if (typeof obj.aiTitle === 'string' && obj.aiTitle) {
      title = obj.aiTitle;
    }
  }

  return { cwd, title };
}

export function needsScan(filePath: string, lastRunAt: string | null): boolean {
  if (!lastRunAt) {
    return true;
  }

  try {
    const fileMtime = statSync(filePath).mtime;
    const lastRunDate = new Date(lastRunAt);
    return fileMtime >= lastRunDate;
  } catch {
    return true;
  }
}
