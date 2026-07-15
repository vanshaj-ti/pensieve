import type { ParsedLine } from '../ingest/parser.js';

export interface EpisodeDraft {
  date: string;
  projectDir: string;
  sessionId: string;
  startLine: number;
  endLine: number;
  lines: ParsedLine[];
}
