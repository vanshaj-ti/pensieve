import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/pipeline.js');
vi.mock('../src/brief.js');
vi.mock('../src/db/schema.js', () => ({ openDb: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock('../src/synthesis.js');
vi.mock('../src/analytics/derivedInsights.js');

describe('CLI command function (direct invocation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('--force passes force flag to pipeline', async () => {
    const { runAnalyzeCommand } = await import('../src/cli.js');
    const { runDailyAnalysis } = await import('../src/pipeline.js');
    const { writeBrief } = await import('../src/brief.js');

    vi.mocked(runDailyAnalysis).mockResolvedValue({
      sessionsProcessed: 0,
      sessionsFailed: 0,
      insightsPersisted: 0,
      episodesFound: 0,
      datesTouched: [],
      label: 'run-test',
    });

    vi.mocked(writeBrief).mockReturnValue({
      path: '/tmp/brief.md',
      insightCount: 0,
    });

    await runAnalyzeCommand({ force: true });

    expect(vi.mocked(runDailyAnalysis)).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
      }),
    );
  });

  it('--dry-run skips brief writing', async () => {
    const { runAnalyzeCommand } = await import('../src/cli.js');
    const { runDailyAnalysis } = await import('../src/pipeline.js');
    const { writeBrief } = await import('../src/brief.js');

    vi.mocked(runDailyAnalysis).mockResolvedValue({
      sessionsProcessed: 1,
      sessionsFailed: 0,
      insightsPersisted: 0,
      episodesFound: 3,
      datesTouched: ['2026-07-15'],
      label: 'run-test',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runAnalyzeCommand({ dryRun: true });

    expect(vi.mocked(writeBrief)).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('insights not computed in dry-run mode'),
    );
    logSpy.mockRestore();
  });

  it('--date writes brief only for specified date, not datesTouched', async () => {
    const { runAnalyzeCommand } = await import('../src/cli.js');
    const { runDailyAnalysis } = await import('../src/pipeline.js');
    const { writeBrief } = await import('../src/brief.js');

    vi.mocked(runDailyAnalysis).mockResolvedValue({
      sessionsProcessed: 1,
      sessionsFailed: 0,
      insightsPersisted: 1,
      episodesFound: 1,
      datesTouched: ['2026-07-15', '2026-07-16'],
      label: 'run-test',
    });

    vi.mocked(writeBrief).mockReturnValue({
      path: '/tmp/2026-07-10.md',
      insightCount: 2,
    });

    await runAnalyzeCommand({ date: '2026-07-10' });

    expect(vi.mocked(writeBrief)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeBrief)).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-07-10',
      }),
    );
  });

  it('without --date writes briefs for today and datesTouched', async () => {
    const { runAnalyzeCommand } = await import('../src/cli.js');
    const { runDailyAnalysis } = await import('../src/pipeline.js');
    const { writeBrief } = await import('../src/brief.js');

    vi.mocked(runDailyAnalysis).mockResolvedValue({
      sessionsProcessed: 2,
      sessionsFailed: 0,
      insightsPersisted: 2,
      episodesFound: 2,
      datesTouched: ['2026-07-13', '2026-07-14'],
      label: 'run-test',
    });

    vi.mocked(writeBrief).mockReturnValue({
      path: '/tmp/brief.md',
      insightCount: 1,
    });

    await runAnalyzeCommand({});

    // Should write at least 2 briefs (today + at least one from datesTouched)
    expect(vi.mocked(writeBrief).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('CLI derive-insights command function (direct invocation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches work items for the run, derives insights, and persists them', async () => {
    const { runDeriveInsightsCommand } = await import('../src/cli.js');
    const { deriveSessionInsights } = await import('../src/synthesis.js');
    const { getWorkItemsForRun, insertDerivedInsights } =
      await import('../src/analytics/derivedInsights.js');

    const workItems = [
      {
        id: 1,
        episodeId: 1,
        category: 'bug_fix' as const,
        text: 'Fixed a real bug',
        evidenceRef: 'line:1',
        significanceScore: 5,
        effortClass: 'judgment' as const,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2026-07-15T00:00:00Z',
      },
    ];
    const derived = [
      {
        projectDir: '-Users-test-project',
        sessionId: 'session-1',
        label: 'run-1',
        insightType: 'win' as const,
        text: 'Shipped a real fix',
        evidenceInsightIds: [1],
        createdAt: '2026-07-15T00:00:00Z',
      },
    ];

    vi.mocked(getWorkItemsForRun).mockReturnValue(workItems);
    vi.mocked(deriveSessionInsights).mockResolvedValue(derived);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runDeriveInsightsCommand({
      project: '-Users-test-project',
      session: 'session-1',
      label: 'run-1',
    });

    expect(vi.mocked(getWorkItemsForRun)).toHaveBeenCalledWith(
      expect.anything(),
      '-Users-test-project',
      'session-1',
      'run-1',
    );
    expect(vi.mocked(deriveSessionInsights)).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: '-Users-test-project',
        sessionId: 'session-1',
        label: 'run-1',
        workItems,
      }),
    );
    expect(vi.mocked(insertDerivedInsights)).toHaveBeenCalledWith(expect.anything(), derived);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Derived 1 insight from 1 work item'),
    );
    logSpy.mockRestore();
  });
});
