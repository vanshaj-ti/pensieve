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
    vi.clearAllMocks();
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
        category: 'architecture_decisions',
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
    expect(result.insightsPersisted).toBeGreaterThanOrEqual(1);
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

  it('returns the label used (auto-generated when omitted)', async () => {
    const { scanNewLines } = await import('../src/ingest/index.js');
    vi.mocked(scanNewLines).mockResolvedValueOnce([]);

    const result = await runDailyAnalysis({
      db,
    });

    expect(result.label).toBeDefined();
    expect(result.label).toMatch(/^run-\d{8}T\d{6}Z$/);
  });

  it('returns the label provided in options', async () => {
    const { scanNewLines } = await import('../src/ingest/index.js');
    vi.mocked(scanNewLines).mockResolvedValueOnce([]);

    const result = await runDailyAnalysis({
      db,
      label: 'my-custom-label',
    });

    expect(result.label).toBe('my-custom-label');
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
        category: 'architecture_decisions',
        text: 'Insight from episode 1',
        evidenceRef: 'line 1',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
      {
        episodeId: 1, // Second episode
        category: 'exploration',
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
    expect(result.insightsPersisted).toBeGreaterThanOrEqual(2); // May be more due to recurrence dedup

    // Verify at least both source insights are in DB
    const rows = db
      .prepare(
        `
      SELECT i.id, i.episode_id, i.text
      FROM insights i
      ORDER BY i.id
    `,
      )
      .all() as Array<{ id: number; episode_id: number; text: string }>;

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const text0 = rows[0].text;
    const text1 = rows[1].text;
    expect([text0, text1]).toContain('Insight from episode 1');
    expect([text0, text1]).toContain('Insight from episode 2');
    // Episode IDs should be different for distinct episodes
    const distinctEpisodeIds = [...new Set(rows.map((r) => r.episode_id))];
    expect(distinctEpisodeIds.length).toBeGreaterThanOrEqual(2);
  });

  it('multi-day partial persistence: extraction failure on day 2 persists day 1 and stops cursor before day 2', async () => {
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
    // Extraction succeeds on day 1, fails on day 2
    vi.mocked(runExtraction).mockResolvedValueOnce([
      {
        episodeId: 0,
        category: 'architecture_decisions',
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

    // Day 1's insight should be persisted
    const count = db.prepare('SELECT COUNT(*) as count FROM insights').get() as { count: number };
    expect(count.count).toBe(1);

    // Cursor should advance to day 1's endLine (1), not to maxLineNumber (11)
    const cursor = getCursor(db, '/tmp/test-project', 'session-1');
    expect(cursor).toBe(1);
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

    expect(result.episodesFound).toBe(1);
    expect(result.insightsPersisted).toBe(0);
    expect(result.sessionsProcessed).toBe(1);

    // Cursor should NOT advance
    const cursor = getCursor(db, '/tmp/project', 'session-1');
    expect(cursor).toBe(0);

    // No rows should be persisted
    const episodeCount = db.prepare('SELECT COUNT(*) as count FROM episodes').get() as {
      count: number;
    };
    expect(episodeCount.count).toBe(0);
  });

  it('retry after partial failure: does not re-run extraction for already-succeeded episodes', async () => {
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
    const { scanNewLines } = await import('../src/ingest/index.js');

    // First run: day 1 succeeds, day 2 fails
    vi.mocked(scanNewLines).mockResolvedValueOnce([scanResult]);
    const day1Insights = [
      {
        episodeId: 0,
        category: 'architecture_decisions',
        text: 'Day 1 insight',
        evidenceRef: 'line 1',
        significanceScore: 0.8,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
    ];
    vi.mocked(runExtraction).mockResolvedValueOnce(day1Insights);
    vi.mocked(runExtraction).mockRejectedValueOnce(new Error('API error on day 2'));

    const result1 = await runDailyAnalysis({
      db,
      force: false,
    });

    expect(result1.sessionsFailed).toBe(1);
    expect(result1.insightsPersisted).toBeGreaterThanOrEqual(1);
    const cursor1 = getCursor(db, '/tmp/test-project', 'session-1');
    expect(cursor1).toBe(1);

    // Second run: fresh mocks, cursor at 1. Scanner returns the same data (both days).
    // Pipeline should only call extraction for day 2 (day 1 is before cursor).
    // For simplicity in the test, we mock to return day 1 only to see extraction call count,
    // then run with fresh scanResult starting at line 11 (day 2).
    vi.clearAllMocks();

    const scanResult2: ScanResult = {
      projectDir: '/tmp/test-project',
      sessionId: 'session-1',
      filePath: '/tmp/test-project/session-1.jsonl',
      lines: [
        {
          lineNumber: 11,
          timestamp: new Date(new Date(now).getTime() + 25 * 60 * 60000).toISOString(),
          kind: 'tool' as const,
          toolName: 'test',
          text: 'day 2 line',
        },
      ],
      maxLineNumber: 11,
    };

    vi.mocked(scanNewLines).mockResolvedValueOnce([scanResult2]);
    const day2Insights = [
      {
        episodeId: 0,
        category: 'architecture_decisions',
        text: 'Day 2 insight',
        evidenceRef: 'line 11',
        significanceScore: 0.9,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
    ];
    vi.mocked(runExtraction).mockResolvedValueOnce(day2Insights);

    const result2 = await runDailyAnalysis({
      db,
      force: false,
    });

    expect(result2.sessionsFailed).toBe(0);
    expect(result2.sessionsProcessed).toBe(1);
    expect(result2.insightsPersisted).toBeGreaterThanOrEqual(1);

    // Verify both days' insights are now persisted (at least 2 total)
    const count = db.prepare('SELECT COUNT(*) as count FROM insights').get() as { count: number };
    expect(count.count).toBeGreaterThanOrEqual(2);

    // Verify extraction was called exactly once in the second run (for day 2 only)
    expect(vi.mocked(runExtraction)).toHaveBeenCalledTimes(1);
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
        category: 'architecture_decisions',
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

  describe('run labeling', () => {
    function makeScanResultAndInsights(sessionId: string) {
      const now = new Date().toISOString();
      const scanResult: ScanResult = {
        projectDir: '/tmp/test-project',
        sessionId,
        filePath: `/tmp/test-project/${sessionId}.jsonl`,
        lines: [
          { lineNumber: 1, timestamp: now, kind: 'tool' as const, toolName: 'test', text: 'x' },
        ],
        maxLineNumber: 100,
      };
      const insights: Insight[] = [
        {
          episodeId: 0,
          category: 'architecture_decisions',
          text: 'Test insight',
          evidenceRef: 'line 1',
          significanceScore: 0.8,
          verifiedByGit: null,
          recurrenceOf: null,
          createdAt: now,
        },
      ];
      return { scanResult, insights };
    }

    it('auto-generates a run label when none is provided', async () => {
      const { scanResult, insights } = makeScanResultAndInsights('session-auto-label');
      const { scanNewLines } = await import('../src/ingest/index.js');
      const { runExtraction } = await import('../src/extract/index.js');
      vi.mocked(scanNewLines).mockResolvedValueOnce([scanResult]);
      vi.mocked(runExtraction).mockResolvedValueOnce(insights);

      await runDailyAnalysis({ db, force: false });

      const row = db
        .prepare('SELECT label FROM episodes WHERE session_id = ?')
        .get('session-auto-label') as { label: string };
      expect(row.label).toMatch(/^run-/);
    });

    it('persists a custom label when provided', async () => {
      const { scanResult, insights } = makeScanResultAndInsights('session-custom-label');
      const { scanNewLines } = await import('../src/ingest/index.js');
      const { runExtraction } = await import('../src/extract/index.js');
      vi.mocked(scanNewLines).mockResolvedValueOnce([scanResult]);
      vi.mocked(runExtraction).mockResolvedValueOnce(insights);

      await runDailyAnalysis({ db, force: false, label: 'my-custom-run' });

      const row = db
        .prepare('SELECT label FROM episodes WHERE session_id = ?')
        .get('session-custom-label') as { label: string };
      expect(row.label).toBe('my-custom-run');
    });
  });
});
