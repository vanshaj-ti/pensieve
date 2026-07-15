import { readdirSync, statSync } from 'node:fs';
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
