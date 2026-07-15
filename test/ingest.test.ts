import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSessionLines } from '../src/ingest/parser.js';
import { listSessionFiles, needsScan } from '../src/ingest/scanner.js';
import {
  getCursor,
  getLastRunAt,
  advanceCursor,
  effectiveStartLine,
} from '../src/ingest/cursor.js';
import { scanNewLines } from '../src/ingest/index.js';
import { openDb } from '../src/db/schema.js';
import * as cursorModule from '../src/ingest/cursor.js';
import * as parserModule from '../src/ingest/parser.js';

describe('ingest', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pensieve-test-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe('parser', () => {
    it('filters noise types and keeps user/assistant', async () => {
      const jsonl = join(tempDir, 'session.jsonl');
      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: 'hello' }),
          JSON.stringify({ type: 'system', timestamp: '2026-01-01T00:00:01Z' }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-01-01T00:00:02Z',
            message: { content: [{ type: 'text', text: 'hi' }] },
          }),
          JSON.stringify({ type: 'attachment', timestamp: '2026-01-01T00:00:03Z' }),
          JSON.stringify({ type: 'file-history-snapshot', timestamp: '2026-01-01T00:00:04Z' }),
        ].join('\n'),
      );

      const result = await parseSessionLines(jsonl);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].type).toBe('user');
      expect(result.lines[1].type).toBe('assistant');
      expect(result.maxLineNumber).toBe(5);
    });

    it('detects tool_use in assistant messages', async () => {
      const jsonl = join(tempDir, 'session.jsonl');
      writeFileSync(
        jsonl,
        [
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-01-01T00:00:00Z',
            message: {
              content: [
                { type: 'text', text: 'using a tool' },
                { type: 'tool_use', id: 'abc', name: 'grep' },
              ],
            },
          }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-01-01T00:00:01Z',
            message: { content: [{ type: 'text', text: 'no tool here' }] },
          }),
        ].join('\n'),
      );

      const result = await parseSessionLines(jsonl);
      expect(result.lines[0].hasToolUse).toBe(true);
      expect(result.lines[1].hasToolUse).toBe(false);
    });

    it('handles malformed JSON gracefully', async () => {
      const jsonl = join(tempDir, 'session.jsonl');
      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          'not valid json at all',
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z' }),
        ].join('\n'),
      );

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await parseSessionLines(jsonl);
      consoleSpy.mockRestore();

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].lineNumber).toBe(1);
      expect(result.lines[1].lineNumber).toBe(3);
      expect(result.maxLineNumber).toBe(3);
    });

    it('respects startLine parameter', async () => {
      const jsonl = join(tempDir, 'session.jsonl');
      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:02Z' }),
        ].join('\n'),
      );

      const result = await parseSessionLines(jsonl, 1);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].lineNumber).toBe(2);
      expect(result.lines[1].lineNumber).toBe(3);
    });
  });

  describe('scanner', () => {
    it('enumerates session files correctly', () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const projDir = join(projectsDir, 'my-project');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(join(projDir, 'abc123.jsonl'), '{}');
      writeFileSync(join(projDir, 'def456.jsonl'), '{}');

      const files = listSessionFiles(projectsDir);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.sessionId).sort()).toEqual(['abc123', 'def456']);
    });

    it('returns empty list for missing directory', () => {
      const files = listSessionFiles(join(tempDir, 'nonexistent'));
      expect(files).toEqual([]);
    });

    it('skips non-jsonl files', () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const projDir = join(projectsDir, 'my-project');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(join(projDir, 'abc123.jsonl'), '{}');
      writeFileSync(join(projDir, 'readme.md'), 'hello');

      const files = listSessionFiles(projectsDir);
      expect(files).toHaveLength(1);
      expect(files[0].sessionId).toBe('abc123');
    });

    it('needsScan returns true when no lastRunAt', () => {
      const jsonl = join(tempDir, 'session.jsonl');
      writeFileSync(jsonl, '{}');

      expect(needsScan(jsonl, null)).toBe(true);
      expect(needsScan(jsonl, undefined as string | null)).toBe(true);
    });

    it('needsScan returns true when file mtime > lastRunAt', () => {
      const jsonl = join(tempDir, 'session.jsonl');
      writeFileSync(jsonl, '{}');

      const pastDate = new Date(Date.now() - 10000).toISOString();
      expect(needsScan(jsonl, pastDate)).toBe(true);
    });

    it('needsScan returns false when file mtime <= lastRunAt', () => {
      const jsonl = join(tempDir, 'session.jsonl');
      writeFileSync(jsonl, '{}');

      const futureDate = new Date(Date.now() + 10000).toISOString();
      expect(needsScan(jsonl, futureDate)).toBe(false);
    });

    it('needsScan returns true when file does not exist', () => {
      expect(needsScan(join(tempDir, 'nonexistent.jsonl'), '2026-01-01T00:00:00Z')).toBe(true);
    });
  });

  describe('cursor', () => {
    it('getCursor returns 0 for new session', () => {
      const db = openDb(dbPath);
      const cursor = getCursor(db, 'proj1', 'sess1');
      expect(cursor).toBe(0);
    });

    it('getLastRunAt returns null for new session', () => {
      const db = openDb(dbPath);
      const lastRunAt = getLastRunAt(db, 'proj1', 'sess1');
      expect(lastRunAt).toBe(null);
    });

    it('advanceCursor inserts and updates correctly', () => {
      const db = openDb(dbPath);
      advanceCursor(db, 'proj1', 'sess1', 42);

      const cursor = getCursor(db, 'proj1', 'sess1');
      expect(cursor).toBe(42);

      const lastRunAt = getLastRunAt(db, 'proj1', 'sess1');
      expect(lastRunAt).toBeTruthy();
      expect(new Date(lastRunAt!).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it('advanceCursor updates existing row', () => {
      const db = openDb(dbPath);
      advanceCursor(db, 'proj1', 'sess1', 10);
      advanceCursor(db, 'proj1', 'sess1', 20);

      const cursor = getCursor(db, 'proj1', 'sess1');
      expect(cursor).toBe(20);
    });

    it('effectiveStartLine returns cursor when force=false', () => {
      const db = openDb(dbPath);
      advanceCursor(db, 'proj1', 'sess1', 15);

      const line = effectiveStartLine(db, 'proj1', 'sess1', false);
      expect(line).toBe(15);
    });

    it('effectiveStartLine returns 0 when force=true', () => {
      const db = openDb(dbPath);
      advanceCursor(db, 'proj1', 'sess1', 15);

      const line = effectiveStartLine(db, 'proj1', 'sess1', true);
      expect(line).toBe(0);
    });
  });

  describe('scanNewLines', () => {
    it('returns all lines on first scan', async () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const jsonl = join(projectsDir, 'proj1', 'sess1.jsonl');
      mkdirSync(join(projectsDir, 'proj1'), { recursive: true });
      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: {} }),
        ].join('\n'),
      );

      const db = openDb(dbPath);
      const results = await scanNewLines(db, { claudeProjectsDir: projectsDir });

      expect(results).toHaveLength(1);
      expect(results[0].lines).toHaveLength(2);
      expect(results[0].maxLineNumber).toBe(2);
    });

    it('returns only new lines after advancing cursor', async () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const jsonl = join(projectsDir, 'proj1', 'sess1.jsonl');
      mkdirSync(join(projectsDir, 'proj1'), { recursive: true });
      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z' }),
        ].join('\n'),
      );

      const db = openDb(dbPath);
      let results = await scanNewLines(db, { claudeProjectsDir: projectsDir });
      expect(results).toHaveLength(1);
      expect(results[0].lines).toHaveLength(2);
      expect(results[0].maxLineNumber).toBe(2);

      advanceCursor(db, 'proj1', 'sess1', 2);

      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:02Z' }),
        ].join('\n'),
      );

      results = await scanNewLines(db, { claudeProjectsDir: projectsDir });
      expect(results).toHaveLength(1);
      expect(results[0].lines).toHaveLength(1);
      expect(results[0].lines[0].lineNumber).toBe(3);
    });

    it('does not call advanceCursor internally', async () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const jsonl = join(projectsDir, 'proj1', 'sess1.jsonl');
      mkdirSync(join(projectsDir, 'proj1'), { recursive: true });
      writeFileSync(jsonl, JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }));

      const db = openDb(dbPath);
      const spy = vi.spyOn(cursorModule, 'advanceCursor');

      await scanNewLines(db, { claudeProjectsDir: projectsDir });
      expect(spy).toHaveBeenCalledTimes(0);

      spy.mockRestore();
    });

    it('skips files with no mtime change', async () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const jsonl = join(projectsDir, 'proj1', 'sess1.jsonl');
      mkdirSync(join(projectsDir, 'proj1'), { recursive: true });
      writeFileSync(jsonl, JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }));

      const db = openDb(dbPath);
      const futureDate = new Date(Date.now() + 10000).toISOString();
      db.prepare(
        `INSERT INTO sessions (project_dir, session_id, last_line, last_run_at)
         VALUES (?, ?, ?, ?)`,
      ).run('proj1', 'sess1', 1, futureDate);

      const spy = vi.spyOn(parserModule, 'parseSessionLines');
      await scanNewLines(db, { claudeProjectsDir: projectsDir });
      expect(spy).toHaveBeenCalledTimes(0);

      spy.mockRestore();
    });

    it('respects force bypass', async () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const jsonl = join(projectsDir, 'proj1', 'sess1.jsonl');
      mkdirSync(join(projectsDir, 'proj1'), { recursive: true });
      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z' }),
        ].join('\n'),
      );

      const db = openDb(dbPath);
      advanceCursor(db, 'proj1', 'sess1', 2);

      const results = await scanNewLines(db, { claudeProjectsDir: projectsDir, force: true });
      expect(results[0].lines).toHaveLength(2);
      expect(results[0].lines[0].lineNumber).toBe(1);
    });

    it('reports maxLineNumber even for all-noise stretches', async () => {
      const projectsDir = join(tempDir, '.claude', 'projects');
      const jsonl = join(projectsDir, 'proj1', 'sess1.jsonl');
      mkdirSync(join(projectsDir, 'proj1'), { recursive: true });
      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z' }),
        ].join('\n'),
      );

      const db = openDb(dbPath);
      let results = await scanNewLines(db, { claudeProjectsDir: projectsDir });
      expect(results[0].lines).toHaveLength(2);
      advanceCursor(db, 'proj1', 'sess1', 2);

      writeFileSync(
        jsonl,
        [
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z' }),
          JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z' }),
          JSON.stringify({ type: 'system', timestamp: '2026-01-01T00:00:02Z' }),
          JSON.stringify({ type: 'attachment', timestamp: '2026-01-01T00:00:03Z' }),
        ].join('\n'),
      );

      results = await scanNewLines(db, { claudeProjectsDir: projectsDir });
      expect(results).toHaveLength(1);
      expect(results[0].lines).toHaveLength(0);
      expect(results[0].maxLineNumber).toBe(4);
    });
  });
});
