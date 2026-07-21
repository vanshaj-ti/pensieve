import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runDailyAnalysis } from '../src/pipeline.js';
import { openDb } from '../src/db/schema.js';
import { getCursor } from '../src/ingest/cursor.js';
import type { ScanResult } from '../src/ingest/index.js';
import type { Insight } from '../src/types.js';
import type Anthropic from '@anthropic-ai/sdk';

vi.mock('../src/ingest/index.js');
vi.mock('../src/extract/index.js');
// pipeline.ts now runs runEngagementAnalysis concurrently with
// runExtraction on every date-batch — tests that don't explicitly
// override this mock would make a real Anthropic API call, which either
// fails (no/invalid key) or returns unexpected data, causing a
// "FOREIGN KEY constraint failed" on the engagement_turns insert (real
// bug found live when the "multi-episode day" test began failing after
// the engagement feature was added to pipeline.ts). Default to [] so
// existing insight-focused tests stay unaffected.
vi.mock('../src/engagement/index.js', () => ({
  runEngagementAnalysis: vi.fn().mockResolvedValue([]),
}));

describe('pipeline', () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = mkdtempSync('pensieve-test-');
    db = openDb(join(tempDir, 'test.db'));
    // Re-apply the default after clearAllMocks — clearAllMocks resets all
    // mock implementations, not just call counts.
    const { runEngagementAnalysis } = await import('../src/engagement/index.js');
    vi.mocked(runEngagementAnalysis).mockResolvedValue([]);
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
    // Pinned mid-day timestamps, not new Date() + offset — this test's
    // "same day, two episodes" premise is flaky/time-dependent near local
    // midnight: new Date() + 30min can cross into the next calendar day
    // (bucketByDay buckets by LOCAL date), silently splitting what the
    // test assumes is one date-batch into two, each with its own temp
    // episode id 0 — the mocked runExtraction's episodeId:1 insight then
    // has no matching real episode in the second batch and fails its
    // FOREIGN KEY constraint on insert. Real bug found live (this test
    // failed exactly once IST local time was within 30 min of midnight).
    const now = '2026-07-15T10:00:00.000Z';
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

  it('retry after partial failure: does not re-extract already-persisted day, only the failed one', async () => {
    const now = new Date().toISOString();
    const day1Line = {
      lineNumber: 1,
      timestamp: now,
      kind: 'tool' as const,
      toolName: 'test',
      text: 'day 1 line',
    };
    const day2Line = {
      lineNumber: 11,
      timestamp: new Date(new Date(now).getTime() + 25 * 60 * 60000).toISOString(), // Next day
      kind: 'tool' as const,
      toolName: 'test',
      text: 'day 2 line',
    };

    const { scanNewLines } = await import('../src/ingest/index.js');
    const { runExtraction } = await import('../src/extract/index.js');

    // --- Run 1: day 1 succeeds, day 2 fails ---
    vi.mocked(scanNewLines).mockResolvedValueOnce([
      {
        projectDir: '/tmp/test-project',
        sessionId: 'session-1',
        filePath: '/tmp/test-project/session-1.jsonl',
        lines: [day1Line, day2Line],
        maxLineNumber: 11,
      },
    ]);
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

    const firstRun = await runDailyAnalysis({ db, force: false });
    expect(firstRun.sessionsFailed).toBe(1);
    expect(runExtraction).toHaveBeenCalledTimes(2);

    const cursorAfterFirstRun = getCursor(db, '/tmp/test-project', 'session-1');
    expect(cursorAfterFirstRun).toBe(1); // stopped before day 2, matching the partial-persistence test above

    // --- Run 2 (retry): real scanNewLines would only re-scan lines past the
    // advanced cursor (line 1) — i.e. day 2's line only. This is the crux of
    // the intake requirement: a retry must NOT re-run extraction for day 1,
    // whose episode+insight already committed in run 1's own transaction. ---
    vi.mocked(scanNewLines).mockResolvedValueOnce([
      {
        projectDir: '/tmp/test-project',
        sessionId: 'session-1',
        filePath: '/tmp/test-project/session-1.jsonl',
        lines: [day2Line],
        maxLineNumber: 11,
      },
    ]);
    vi.mocked(runExtraction).mockResolvedValueOnce([
      {
        episodeId: 0,
        category: 'bug_fix',
        text: 'Day 2 insight (retry succeeded)',
        evidenceRef: 'line 11',
        significanceScore: 0.7,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: now,
      },
    ]);

    const secondRun = await runDailyAnalysis({ db, force: false });

    // Only day 2's extraction ran on retry — not day 1's again.
    expect(runExtraction).toHaveBeenCalledTimes(3);
    expect(secondRun.sessionsFailed).toBe(0);
    expect(secondRun.insightsPersisted).toBe(1);

    // Both days' insights are now persisted — day 1 from run 1, day 2 from run 2.
    const rows = db.prepare('SELECT text FROM insights ORDER BY id').all() as Array<{
      text: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe('Day 1 insight');
    expect(rows[1].text).toBe('Day 2 insight (retry succeeded)');

    // Cursor now advances all the way to maxLineNumber.
    const cursorAfterSecondRun = getCursor(db, '/tmp/test-project', 'session-1');
    expect(cursorAfterSecondRun).toBe(11);
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

    // Dry-run must NOT call runExtraction (no paid API calls)
    expect(vi.mocked(runExtraction)).not.toHaveBeenCalled();

    // Cursor should NOT advance
    const cursor = getCursor(db, '/tmp/project', 'session-1');
    expect(cursor).toBe(0);

    // No rows should be persisted
    const episodeCount = db.prepare('SELECT COUNT(*) as count FROM episodes').get() as {
      count: number;
    };
    expect(episodeCount.count).toBe(0);
  });

  it('full success: cursor advances to maxLineNumber', async () => {
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

    const result = await runDailyAnalysis({
      db,
      force: false,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.sessionsFailed).toBe(0);

    // After full success, cursor should advance to maxLineNumber, not just episode endLine
    const cursor = getCursor(db, '/tmp/test-project', 'session-1');
    expect(cursor).toBe(100);
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

  it('engagement analysis: persists engagement_turns rows including directiveNecessary=false without throwing (regression for boolean-bind bug)', async () => {
    // Real bug found live: better-sqlite3 rejects a raw JS boolean bound
    // param ("SQLite3 can only bind numbers, strings, bigints, buffers, and
    // null") — insights.verified_by_git never exercised this since it's a
    // dormant field always left null. This exercises directiveNecessary
    // with real true/false values through the actual insert.
    const now = new Date().toISOString();
    const scanResult: ScanResult = {
      projectDir: '/tmp/test-project',
      sessionId: 'session-1',
      filePath: '/tmp/test-project/session-1.jsonl',
      lines: [
        {
          lineNumber: 1,
          type: 'assistant',
          timestamp: now,
          hasToolUse: false,
          raw: {
            type: 'assistant',
            timestamp: now,
            message: { content: [{ type: 'text', text: 'Should I use approach A or B?' }] },
          },
        },
        {
          lineNumber: 2,
          type: 'user',
          timestamp: now,
          hasToolUse: false,
          raw: { type: 'user', timestamp: now, message: { content: 'Use approach B.' } },
        },
        {
          lineNumber: 3,
          type: 'assistant',
          timestamp: now,
          hasToolUse: true,
          raw: {
            type: 'assistant',
            timestamp: now,
            message: {
              content: [
                { type: 'text', text: 'Implemented approach B.' },
                { type: 'tool_use', name: 'bash', input: { command: 'npm test' } },
              ],
            },
          },
        },
        {
          lineNumber: 4,
          type: 'user',
          timestamp: now,
          hasToolUse: false,
          raw: { type: 'user', timestamp: now, message: { content: 'run the tests again' } },
        },
      ],
      maxLineNumber: 100,
    };

    const insights: Insight[] = [];

    const { scanNewLines } = await import('../src/ingest/index.js');
    const { runExtraction } = await import('../src/extract/index.js');
    const { runEngagementAnalysis: realRunEngagementAnalysis } = await vi.importActual<
      typeof import('../src/engagement/index.js')
    >('../src/engagement/index.js');
    const { runEngagementAnalysis } = await import('../src/engagement/index.js');

    vi.mocked(scanNewLines).mockResolvedValueOnce([scanResult]);
    vi.mocked(runExtraction).mockResolvedValueOnce(insights);
    // This test exercises the real turn-pair-derivation -> Haiku-call ->
    // dedup chain (not the beforeEach's default []-returning mock) to
    // verify the actual insert path handles a real boolean value.
    vi.mocked(runEngagementAnalysis).mockImplementation(realRunEngagementAnalysis);

    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_engagement_classifications',
          input: {
            candidates: [
              {
                humanLineNumber: 2,
                classification: 'deliberative',
                directiveNecessary: null,
                reason: 'resolved the agent question with a concrete choice',
              },
              {
                humanLineNumber: 4,
                classification: 'directive',
                directiveNecessary: false,
                reason: 'told agent to re-run tests it already had access to run itself',
              },
            ],
          },
        },
      ],
    });
    const client = {
      beta: { promptCaching: { messages: { create: mockCreate } } },
    } as unknown as Anthropic;

    await runDailyAnalysis({
      db,
      force: false,
      client,
    });

    const rows = db
      .prepare(
        'SELECT classification, directive_necessary FROM engagement_turns ORDER BY human_line_number',
      )
      .all() as Array<{ classification: string; directive_necessary: number | null }>;
    expect(rows).toEqual([
      { classification: 'deliberative', directive_necessary: null },
      { classification: 'directive', directive_necessary: 0 },
    ]);
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
