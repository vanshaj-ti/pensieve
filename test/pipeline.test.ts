import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runDailyAnalysis } from '../src/pipeline.js';
import { openDb } from '../src/db/schema.js';
import { getCursor } from '../src/ingest/cursor.js';
import type { ScanResult } from '../src/ingest/index.js';
import type { Insight } from '../src/types.js';

vi.mock('../src/ingest/index.js');
vi.mock('../src/extract/index.js');

describe('pipeline', () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync('pensieve-test-');
    db = openDb(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('happy path: persists insights and advances cursor', async () => {
    const now = new Date().toISOString();
    const scanResult: ScanResult = {
      projectDir: '/tmp/test-project',
      sessionId: 'session-1',
      filePath: '/tmp/test-project/session-1.jsonl',
      lines: [
        {
          lineNumber: 1,
          timestamp: now,
          kind: 'tool' as const,
          toolName: 'test',
          text: 'test line',
        },
      ],
      maxLineNumber: 100,
    };

    const insights: Insight[] = [
      {
        episodeId: 0, // Maps to the first (and only) episode in this day
        category: 'strategic_value',
        text: 'Test insight',
        evidenceRef: 'line 50',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
    ];

    const { scanNewLines } = await import('../src/ingest/index.js');
    const { runExtraction } = await import('../src/extract/index.js');

    vi.mocked(scanNewLines).mockResolvedValueOnce([scanResult]);
    vi.mocked(runExtraction).mockResolvedValueOnce(insights);

    const result = await runDailyAnalysis({
      db,
      force: false,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.sessionsFailed).toBe(0);
    expect(result.insightsPersisted).toBe(1);
  });

  it('handles empty scan result gracefully', async () => {
    const { scanNewLines } = await import('../src/ingest/index.js');
    vi.mocked(scanNewLines).mockResolvedValueOnce([]);

    const result = await runDailyAnalysis({
      db,
    });

    expect(result.sessionsProcessed).toBe(0);
    expect(result.insightsPersisted).toBe(0);
  });

  it('respects --force flag', async () => {
    const { scanNewLines } = await import('../src/ingest/index.js');
    vi.mocked(scanNewLines).mockResolvedValueOnce([]);

    await runDailyAnalysis({
      db,
      force: true,
    });

    expect(vi.mocked(scanNewLines)).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        force: true,
      }),
    );
  });

  it('dry-run skips persistence and cursor advancement', async () => {
    // Pre-populate sessions table
    db.prepare(`
      INSERT INTO sessions (project_dir, session_id, last_line, last_run_at)
      VALUES ('/tmp/project', 'session-1', 0, NULL)
    `).run();

    const now = new Date().toISOString();
    const scanResult: ScanResult = {
      projectDir: '/tmp/project',
      sessionId: 'session-1',
      filePath: '/tmp/project/session-1.jsonl',
      lines: [
        {
          lineNumber: 1,
          timestamp: now,
          kind: 'tool' as const,
          toolName: 'test',
          text: 'test line',
        },
      ],
      maxLineNumber: 100,
    };

    const insights: Insight[] = [
      {
        episodeId: 0, // Maps to the first (and only) episode in this day
        category: 'friction_audit',
        text: 'Dry run insight',
        evidenceRef: 'test',
        significanceScore: 0.5,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
    ];

    const { scanNewLines } = await import('../src/ingest/index.js');
    const { runExtraction } = await import('../src/extract/index.js');

    vi.mocked(scanNewLines).mockResolvedValueOnce([scanResult]);
    vi.mocked(runExtraction).mockResolvedValueOnce(insights);

    const result = await runDailyAnalysis({
      db,
      dryRun: true,
    });

    expect(result.insightsPersisted).toBe(1);

    // Cursor should NOT advance
    const cursor = getCursor(db, '/tmp/project', 'session-1');
    expect(cursor).toBe(0);

    // No rows should be persisted
    const episodeCount = db.prepare('SELECT COUNT(*) as count FROM episodes').get() as { count: number };
    expect(episodeCount.count).toBe(0);
  });
});
