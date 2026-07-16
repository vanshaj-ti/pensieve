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

  it('multi-episode day: insights correctly associated to source episodes', async () => {
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
          text: 'episode 1 line',
        },
        {
          lineNumber: 11,
          timestamp: new Date(new Date(now).getTime() + 30 * 60000).toISOString(),
          kind: 'tool' as const,
          toolName: 'test',
          text: 'episode 2 line',
        },
      ],
      maxLineNumber: 11,
    };

    // Two episodes, one insight per episode
    const insights: Insight[] = [
      {
        episodeId: 0, // First episode
        category: 'strategic_value',
        text: 'Insight from episode 1',
        evidenceRef: 'line 1',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
      {
        episodeId: 1, // Second episode
        category: 'decision_record',
        text: 'Insight from episode 2',
        evidenceRef: 'line 11',
        significanceScore: 0.7,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
    ];

    vi.mocked(await import('../src/ingest/index.js')).scanNewLines.mockResolvedValue([scanResult]);
    vi.mocked(await import('../src/extract/index.js')).runExtraction.mockResolvedValue(insights);

    const result = await runDailyAnalysis({
      db,
      force: false,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.insightsPersisted).toBe(2);

    // Verify both insights are in DB with correct episode associations
    const rows = db
      .prepare(
        `
      SELECT i.id, i.episode_id, i.text
      FROM insights i
      ORDER BY i.id
    `,
      )
      .all() as Array<{ id: number; episode_id: number; text: string }>;

    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe('Insight from episode 1');
    expect(rows[1].text).toBe('Insight from episode 2');
    // Episode IDs should be different
    expect(rows[0].episode_id).not.toBe(rows[1].episode_id);
  });

  it('multi-day rollback: extraction failure on day 2 rolls back entire session', async () => {
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
          text: 'day 1 line',
        },
        {
          lineNumber: 11,
          timestamp: new Date(new Date(now).getTime() + 25 * 60 * 60000).toISOString(), // Next day
          kind: 'tool' as const,
          toolName: 'test',
          text: 'day 2 line',
        },
      ],
      maxLineNumber: 11,
    };

    const { runExtraction } = await import('../src/extract/index.js');

    vi.mocked(await import('../src/ingest/index.js')).scanNewLines.mockResolvedValue([scanResult]);
    // Extraction fails on second call (day 2)
    vi.mocked(runExtraction).mockResolvedValueOnce([
      {
        episodeId: 0,
        category: 'strategic_value',
        text: 'Day 1 insight',
        evidenceRef: 'line 1',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
    ]);
    vi.mocked(runExtraction).mockRejectedValueOnce(new Error('API error on day 2'));

    const result = await runDailyAnalysis({
      db,
      force: false,
    });

    expect(result.sessionsFailed).toBe(1);

    // No insights should be persisted (transaction rolled back)
    const count = db.prepare('SELECT COUNT(*) as count FROM insights').get() as { count: number };
    expect(count.count).toBe(0);

    // Cursor should not advance
    const cursor = getCursor(db, '/tmp/test-project', 'session-1');
    expect(cursor).toBe(0);
  });

  it('dry-run skips persistence and cursor advancement', async () => {
    // Pre-populate sessions table
    db.prepare(
      `
      INSERT INTO sessions (project_dir, session_id, last_line, last_run_at)
      VALUES ('/tmp/project', 'session-1', 0, NULL)
    `,
    ).run();

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
    const episodeCount = db.prepare('SELECT COUNT(*) as count FROM episodes').get() as {
      count: number;
    };
    expect(episodeCount.count).toBe(0);
  });

  it('embeddings disabled: no rows inserted into insight_embeddings', async () => {
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
        episodeId: 0,
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

    await runDailyAnalysis({
      db,
      force: false,
    });

    const count = db.prepare('SELECT COUNT(*) as count FROM insight_embeddings').get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });
});
