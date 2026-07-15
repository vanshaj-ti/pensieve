import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/pipeline.js');
vi.mock('../src/brief.js');

describe('CLI command function (direct invocation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('--force passes force flag to pipeline', async () => {
    const { runAnalyzeCommand } = await import('../src/cli.js');
    const { runDailyAnalysis } = await import('../src/pipeline.js');

    vi.mocked(runDailyAnalysis).mockResolvedValue({
      sessionsProcessed: 0,
      sessionsFailed: 0,
      insightsPersisted: 0,
      datesTouched: [],
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
      datesTouched: ['2026-07-15'],
    });

    await runAnalyzeCommand({ dryRun: true });

    expect(vi.mocked(writeBrief)).not.toHaveBeenCalled();
  });

  it('--date writes brief only for specified date, not datesTouched', async () => {
    const { runAnalyzeCommand } = await import('../src/cli.js');
    const { runDailyAnalysis } = await import('../src/pipeline.js');
    const { writeBrief } = await import('../src/brief.js');

    vi.mocked(runDailyAnalysis).mockResolvedValue({
      sessionsProcessed: 1,
      sessionsFailed: 0,
      insightsPersisted: 1,
      datesTouched: ['2026-07-15', '2026-07-16'],
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
      datesTouched: ['2026-07-13', '2026-07-14'],
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
