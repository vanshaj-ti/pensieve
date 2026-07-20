import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { rm } from 'fs/promises';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn(),
  };
});

import Anthropic from '@anthropic-ai/sdk';
import { generateCandidates, HaikuExtractionError } from '../src/extract/haiku.js';
import { verifyAndScore, type CandidateWithSource } from '../src/extract/sonnet.js';
import { runExtraction, type PersistedEpisode } from '../src/extract/index.js';
import { CandidateSchema, InsightSchema } from '../src/types.js';
import type { EpisodeDraft } from '../src/chunk/episodes.js';

describe('Extract: Haiku Pass', () => {
  let client: Anthropic;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreate = vi.fn();
    const mockClient = {
      beta: {
        promptCaching: {
          messages: {
            create: mockCreate,
          },
        },
      },
    };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);
    client = new Anthropic();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Case 1a: Haiku renders tool_result with string content', async () => {
    const episode: EpisodeDraft = {
      date: '2026-07-15',
      projectDir: '/test/project',
      sessionId: 'session-1',
      startLine: 1,
      endLine: 2,
      lines: [
        {
          lineNumber: 1,
          type: 'user',
          timestamp: '2026-07-15T10:00:00Z',
          hasToolUse: false,
          raw: {
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            message: { content: 'run tests' },
          },
        },
        {
          lineNumber: 2,
          type: 'assistant',
          timestamp: '2026-07-15T10:00:01Z',
          hasToolUse: true,
          raw: {
            type: 'assistant',
            timestamp: '2026-07-15T10:00:01Z',
            message: {
              content: [
                { type: 'tool_use', name: 'run_command', input: { cmd: 'npm test' } },
                { type: 'tool_result', content: 'All tests passed' },
              ],
            },
          },
        },
      ],
    };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', name: 'emit_candidates', input: { candidates: [] } }],
    });

    await generateCandidates(episode, client);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('All tests passed');
  });

  it('Case 1b: Haiku renders tool_result with array text blocks', async () => {
    const episode: EpisodeDraft = {
      date: '2026-07-15',
      projectDir: '/test/project',
      sessionId: 'session-2',
      startLine: 1,
      endLine: 2,
      lines: [
        {
          lineNumber: 1,
          type: 'user',
          timestamp: '2026-07-15T10:00:00Z',
          hasToolUse: false,
          raw: {
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            message: { content: 'deploy' },
          },
        },
        {
          lineNumber: 2,
          type: 'assistant',
          timestamp: '2026-07-15T10:00:01Z',
          hasToolUse: true,
          raw: {
            type: 'assistant',
            timestamp: '2026-07-15T10:00:01Z',
            message: {
              content: [
                { type: 'tool_use', name: 'deploy', input: {} },
                {
                  type: 'tool_result',
                  content: [
                    { type: 'text', text: 'Deployment started.' },
                    { type: 'text', text: 'Build succeeded.' },
                    { type: 'text', text: 'Live in production.' },
                  ],
                },
              ],
            },
          },
        },
      ],
    };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', name: 'emit_candidates', input: { candidates: [] } }],
    });

    await generateCandidates(episode, client);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Deployment started');
    expect(call.messages[0].content).toContain('Build succeeded');
    expect(call.messages[0].content).toContain('Live in production');
  });

  it('Case 1: Haiku prompt assembly includes episode content and tool_use/tool_result blocks', async () => {
    const episode: EpisodeDraft = {
      date: '2026-07-15',
      projectDir: '/test/project',
      sessionId: 'session-1',
      startLine: 1,
      endLine: 5,
      lines: [
        {
          lineNumber: 1,
          type: 'user',
          timestamp: '2026-07-15T10:00:00Z',
          hasToolUse: false,
          raw: {
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            message: {
              content: [
                { type: 'text', text: 'What should I build?' },
                { type: 'tool_result', content: 'You asked this question' },
              ],
            },
          },
        },
        {
          lineNumber: 2,
          type: 'assistant',
          timestamp: '2026-07-15T10:00:01Z',
          hasToolUse: true,
          raw: {
            type: 'assistant',
            timestamp: '2026-07-15T10:00:01Z',
            message: {
              content: [
                { type: 'text', text: 'I can help.' },
                {
                  type: 'tool_use',
                  name: 'file_editor',
                  input: { action: 'write', path: 'src/index.ts' },
                },
                { type: 'tool_result', content: 'File written successfully' },
              ],
            },
          },
        },
      ],
    };

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: { candidates: [] },
        },
      ],
    });

    await generateCandidates(episode, client);

    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toBeDefined();
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.temperature).toBe(0);
    expect(call.messages[0].content).toContain('session-1');
    expect(call.messages[0].content).toContain('tool_use');
    expect(call.messages[0].content).toContain('tool_result');
  });

  it('Case 2: Haiku response parsing creates valid Candidate objects', async () => {
    const episode: EpisodeDraft = {
      date: '2026-07-15',
      projectDir: '/test/project',
      sessionId: 'session-1',
      startLine: 1,
      endLine: 2,
      lines: [
        {
          lineNumber: 1,
          type: 'user',
          timestamp: '2026-07-15T10:00:00Z',
          hasToolUse: false,
          raw: {
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            message: { content: 'Test input' },
          },
        },
      ],
    };

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: {
            candidates: [
              {
                category: 'architecture_decisions',
                text: 'Important architecture decision',
                evidenceRef: 'line:1',
                evidenceSnippet: 'Test input',
              },
              {
                category: 'exploration',
                text: 'Database choice',
                evidenceRef: 'line:1',
                evidenceSnippet: 'Test input',
              },
            ],
          },
        },
      ],
    });

    const result = await generateCandidates(episode, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      category: 'architecture_decisions',
      text: 'Important architecture decision',
      evidenceRef: 'line:1',
      evidenceSnippet: 'Test input',
    });
    expect(result[1]).toEqual({
      category: 'exploration',
      text: 'Database choice',
      evidenceRef: 'line:1',
      evidenceSnippet: 'Test input',
    });

    result.forEach((candidate) => {
      expect(() => CandidateSchema.parse(candidate)).not.toThrow();
    });
  });

  it('Case 5a: Schema violation in Haiku response throws error', async () => {
    const episode: EpisodeDraft = {
      date: '2026-07-15',
      projectDir: '/test/project',
      sessionId: 'session-1',
      startLine: 1,
      endLine: 1,
      lines: [
        {
          lineNumber: 1,
          type: 'user',
          timestamp: '2026-07-15T10:00:00Z',
          hasToolUse: false,
          raw: {
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            message: { content: 'test' },
          },
        },
      ],
    };

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: {
            candidates: [
              {
                category: 'architecture_decisions',
                text: 'Missing evidenceSnippet field',
                evidenceRef: 'line:1',
              },
            ],
          },
        },
      ],
    });

    await expect(generateCandidates(episode, client)).rejects.toThrow(HaikuExtractionError);
  });

  it('Case 5c: Non-array candidates field rejected', async () => {
    const episode: EpisodeDraft = {
      date: '2026-07-15',
      projectDir: '/test/project',
      sessionId: 'session-1',
      startLine: 1,
      endLine: 1,
      lines: [
        {
          lineNumber: 1,
          type: 'user',
          timestamp: '2026-07-15T10:00:00Z',
          hasToolUse: false,
          raw: {
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            message: { content: 'test' },
          },
        },
      ],
    };

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: {
            candidates: { category: 'architecture_decisions', text: 'not an array' },
          },
        },
      ],
    });

    await expect(generateCandidates(episode, client)).rejects.toThrow(HaikuExtractionError);
  });
});

describe('Extract: Sonnet Pass', () => {
  let client: Anthropic;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreate = vi.fn();
    const mockClient = {
      beta: {
        promptCaching: {
          messages: {
            create: mockCreate,
          },
        },
      },
    };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);
    client = new Anthropic();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Case 3: Sonnet prompt includes candidates in user message, history in cached system blocks', async () => {
    const candidates: CandidateWithSource[] = [
      {
        episodeId: 1,
        candidate: {
          category: 'architecture_decisions',
          text: 'Candidate 1',
          evidenceRef: 'line:10',
          evidenceSnippet: 'snippet1',
        },
      },
      {
        episodeId: 2,
        candidate: {
          category: 'exploration',
          text: 'Candidate 2',
          evidenceRef: 'line:20',
          evidenceSnippet: 'snippet2',
        },
      },
    ];

    const history = [
      {
        id: 100,
        episodeId: 99,
        category: 'architecture_decisions' as const,
        text: 'Previous insight',
        evidenceRef: 'line:5',
        significanceScore: 4,
        effortClass: 'judgment' as const,
        verifiedByGit: null,
        recurrenceOf: null,
        createdAt: '2026-07-14T10:00:00Z',
      },
    ];

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_insights',
          input: { insights: [] },
        },
      ],
    });

    await verifyAndScore(candidates, history, client);

    const call = mockCreate.mock.calls[0][0];
    const systemBlocks = call.system;
    const systemText = systemBlocks.map((b: any) => b.text).join('\n');
    const userMessage = call.messages[0].content;

    expect(systemBlocks).toHaveLength(2);
    expect(systemBlocks[0]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    });
    expect(systemBlocks[1]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    });

    expect(systemText).toContain('Previous insight');
    expect(userMessage).toContain('Candidate 1');
    expect(userMessage).toContain('Candidate 2');
    expect(userMessage).not.toContain('Previous insight');
    expect(call.temperature).toBeUndefined();
  });

  it('Case 4: Sonnet response parsing always forces recurrenceOf to null, even if Sonnet emits a value', async () => {
    const candidates: CandidateWithSource[] = [
      {
        episodeId: 1,
        candidate: {
          category: 'architecture_decisions',
          text: 'New insight',
          evidenceRef: 'line:15',
          evidenceSnippet: 'test',
        },
      },
    ];

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_insights',
          input: {
            insights: [
              {
                episodeId: 1,
                category: 'architecture_decisions',
                text: 'Polished insight',
                evidenceRef: 'line:15',
                significanceScore: 4,
                effortClass: 'judgment',
                recurrenceOf: 100,
              },
              {
                episodeId: 1,
                category: 'exploration',
                text: 'New decision',
                evidenceRef: 'line:16',
                significanceScore: 3,
                effortClass: 'toil',
                recurrenceOf: null,
              },
            ],
          },
        },
      ],
    });

    const result = await verifyAndScore(candidates, [], client);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      episodeId: 1,
      category: 'architecture_decisions',
      text: 'Polished insight',
      recurrenceOf: null,
      verifiedByGit: null,
    });
    expect(result[1]).toMatchObject({
      episodeId: 1,
      category: 'exploration',
      recurrenceOf: null,
    });

    result.forEach((insight) => {
      expect(() => InsightSchema.parse(insight)).not.toThrow();
    });
  });

  it('Case 5b: Schema violation in Sonnet response throws error', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_insights',
          input: {
            insights: [
              {
                episodeId: 1,
                category: 'invalid_category',
                text: 'test',
                evidenceRef: 'line:1',
                significanceScore: 3,
                recurrenceOf: null,
              },
            ],
          },
        },
      ],
    });

    await expect(verifyAndScore([], [], client)).rejects.toThrow();
  });

  it('Case 5d: Non-array insights field rejected', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_insights',
          input: {
            insights: { episodeId: 1, category: 'architecture_decisions', text: 'not an array' },
          },
        },
      ],
    });

    await expect(verifyAndScore([], [], client)).rejects.toThrow();
  });
});

describe('Extract: Orchestration', () => {
  let tempDir: string;
  let db: Database.Database;
  let client: Anthropic;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = mkdtempSync('extract-test-');
    const dbPath = join(tempDir, 'test.db');
    db = new Database(dbPath);

    db.exec(`
      CREATE TABLE insights (
        id INTEGER PRIMARY KEY,
        episode_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        text TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        significance_score REAL NOT NULL,
        effort_class TEXT NOT NULL DEFAULT 'judgment',
        verified_by_git INTEGER,
        recurrence_of INTEGER,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, effort_class, verified_by_git, recurrence_of, created_at)
      VALUES (99, 'architecture_decisions', 'Old insight', 'line:5', 4.0, 'judgment', NULL, NULL, '2026-07-14T10:00:00Z')
    `);

    mockCreate = vi.fn();
    const mockClient = {
      beta: {
        promptCaching: {
          messages: {
            create: mockCreate,
          },
        },
      },
    };
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);
    client = new Anthropic();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('Case 6: Per-episode isolation — one failure does not crash full run', async () => {
    const episodes: PersistedEpisode[] = [
      {
        id: 1,
        date: '2026-07-15',
        projectDir: '/project',
        sessionId: 'sess-1',
        startLine: 1,
        endLine: 5,
        lines: [
          {
            lineNumber: 1,
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            hasToolUse: false,
            raw: {
              type: 'user',
              timestamp: '2026-07-15T10:00:00Z',
              message: { content: 'episode 1' },
            },
          },
        ],
      },
      {
        id: 2,
        date: '2026-07-15',
        projectDir: '/project',
        sessionId: 'sess-2',
        startLine: 6,
        endLine: 10,
        lines: [
          {
            lineNumber: 6,
            type: 'user',
            timestamp: '2026-07-15T10:01:00Z',
            hasToolUse: false,
            raw: {
              type: 'user',
              timestamp: '2026-07-15T10:01:00Z',
              message: { content: 'episode 2' },
            },
          },
        ],
      },
    ];

    mockCreate
      .mockRejectedValueOnce(new Error('API error on episode 1'))
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_candidates',
            input: {
              candidates: [
                {
                  category: 'friction_audit',
                  text: 'Issue found in episode 2',
                  evidenceRef: 'line:6',
                  evidenceSnippet: 'episode 2',
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            name: 'emit_insights',
            input: {
              insights: [
                {
                  episodeId: 2,
                  category: 'friction_audit',
                  text: 'Verified issue from episode 2',
                  evidenceRef: 'line:6',
                  significanceScore: 3,
                  effortClass: 'toil',
                  recurrenceOf: null,
                },
              ],
            },
          },
        ],
      });

    const result = await runExtraction(episodes, db, client);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      episodeId: 2,
      category: 'friction_audit',
      text: 'Verified issue from episode 2',
    });
  });

  it('Case 7: No real API calls — mock remains active', async () => {
    const episodes: PersistedEpisode[] = [
      {
        id: 1,
        date: '2026-07-15',
        projectDir: '/project',
        sessionId: 'sess-1',
        startLine: 1,
        endLine: 1,
        lines: [
          {
            lineNumber: 1,
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            hasToolUse: false,
            raw: {
              type: 'user',
              timestamp: '2026-07-15T10:00:00Z',
              message: { content: 'test' },
            },
          },
        ],
      },
    ];

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: {
            candidates: [
              {
                category: 'mechanical_labor',
                text: 'AI opportunity',
                evidenceRef: 'line:1',
                evidenceSnippet: 'test',
              },
            ],
          },
        },
      ],
    });

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_insights',
          input: {
            insights: [
              {
                episodeId: 1,
                category: 'mechanical_labor',
                text: 'Verified AI opportunity',
                evidenceRef: 'line:1',
                significanceScore: 4,
                effortClass: 'overhead',
                recurrenceOf: null,
              },
            ],
          },
        },
      ],
    });

    const result = await runExtraction(episodes, db, client);

    expect(result).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('Case 8: Haiku episodes run concurrently, capped at HAIKU_CONCURRENCY, not sequentially', async () => {
    const episodeCount = 12; // > HAIKU_CONCURRENCY (5), enough to exercise the pool refilling
    const episodes: PersistedEpisode[] = Array.from({ length: episodeCount }, (_, i) => ({
      id: i + 1,
      date: '2026-07-15',
      projectDir: '/project',
      sessionId: `sess-${i + 1}`,
      startLine: i + 1,
      endLine: i + 1,
      lines: [
        {
          lineNumber: i + 1,
          type: 'user' as const,
          timestamp: '2026-07-15T10:00:00Z',
          hasToolUse: false,
          raw: {
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            message: { content: `episode ${i + 1}` },
          },
        },
      ],
    }));

    let inFlight = 0;
    let maxInFlight = 0;
    let haikuCallCount = 0;

    mockCreate.mockImplementation(async (args: { tools?: Array<{ name: string }> }) => {
      const isHaikuCall = args.tools?.[0]?.name === 'emit_candidates';
      if (isHaikuCall) {
        haikuCallCount++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield control so overlapping calls actually interleave instead of
        // resolving synchronously in submission order.
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return {
          content: [{ type: 'tool_use', name: 'emit_candidates', input: { candidates: [] } }],
        };
      }
      // Sonnet call — no candidates were produced, so this shouldn't be reached,
      // but return a valid empty response just in case.
      return {
        content: [{ type: 'tool_use', name: 'emit_insights', input: { insights: [] } }],
      };
    });

    await runExtraction(episodes, db, client);

    expect(haikuCallCount).toBe(episodeCount);
    expect(maxInFlight).toBeGreaterThan(1); // genuinely concurrent, not sequential
    expect(maxInFlight).toBeLessThanOrEqual(5); // respects HAIKU_CONCURRENCY
  });

  it('Empty candidates return empty insights', async () => {
    const episodes: PersistedEpisode[] = [
      {
        id: 1,
        date: '2026-07-15',
        projectDir: '/project',
        sessionId: 'sess-1',
        startLine: 1,
        endLine: 1,
        lines: [
          {
            lineNumber: 1,
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            hasToolUse: false,
            raw: {
              type: 'user',
              timestamp: '2026-07-15T10:00:00Z',
              message: { content: 'test' },
            },
          },
        ],
      },
    ];

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: { candidates: [] },
        },
      ],
    });

    const result = await runExtraction(episodes, db, client);

    expect(result).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('Case 9: candidates beyond SONNET_BATCH_SIZE are split across multiple Sonnet calls', async () => {
    // One episode producing 90 candidates from Haiku — well over the
    // 40-candidate Sonnet batch size, so this must NOT be sent to Sonnet
    // in a single call (the real production bug this guards against: a
    // large day's candidates overflowing Sonnet's emit_insights max_tokens
    // and truncating the whole day to zero insights).
    const candidateCount = 90;
    const episodes: PersistedEpisode[] = [
      {
        id: 1,
        date: '2026-07-15',
        projectDir: '/project',
        sessionId: 'sess-1',
        startLine: 1,
        endLine: 1,
        lines: [
          {
            lineNumber: 1,
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            hasToolUse: false,
            raw: {
              type: 'user',
              timestamp: '2026-07-15T10:00:00Z',
              message: { content: 'test' },
            },
          },
        ],
      },
    ];

    mockCreate.mockImplementationOnce(async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: {
            candidates: Array.from({ length: candidateCount }, (_, i) => ({
              category: 'mechanical_labor',
              text: `Candidate ${i}`,
              evidenceRef: `line:${i}`,
              evidenceSnippet: 'test',
            })),
          },
        },
      ],
    }));

    let sonnetCallCount = 0;
    const sonnetBatchSizes: number[] = [];
    mockCreate.mockImplementation(async (args: { tools?: Array<{ name: string }> }) => {
      if (args.tools?.[0]?.name === 'emit_candidates') {
        // Only the first call (above, via mockImplementationOnce) should be Haiku.
        throw new Error('Unexpected second Haiku call');
      }
      sonnetCallCount++;
      // Echo back one insight per candidate actually sent in this call, by
      // reading the candidatesList size embedded in the user message.
      const userContent = (args as unknown as { messages: Array<{ content: string }> }).messages[0]
        .content;
      const matches = userContent.match(/\[Candidate \d+\]/g) ?? [];
      sonnetBatchSizes.push(matches.length);
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_insights',
            input: {
              insights: matches.map((_, i) => ({
                episodeId: 1,
                category: 'mechanical_labor',
                text: `Insight ${i}`,
                evidenceRef: `line:${i}`,
                significanceScore: 3,
                effortClass: 'toil',
                recurrenceOf: null,
              })),
            },
          },
        ],
      };
    });

    const result = await runExtraction(episodes, db, client);

    expect(sonnetCallCount).toBe(3); // ceil(90 / 40) = 3 batches
    expect(sonnetBatchSizes).toEqual([40, 40, 10]);
    expect(result).toHaveLength(candidateCount);
  });

  it('Case 10: one failed Sonnet batch does not take down other batches in the same run', async () => {
    // 90 candidates split into 3 Sonnet batches. First batch fails, second and
    // third succeed. The full run should complete and return only insights
    // from successful batches (not throw, not abort siblings).
    const candidateCount = 90;
    const episodes: PersistedEpisode[] = [
      {
        id: 1,
        date: '2026-07-15',
        projectDir: '/project',
        sessionId: 'sess-1',
        startLine: 1,
        endLine: 1,
        lines: [
          {
            lineNumber: 1,
            type: 'user',
            timestamp: '2026-07-15T10:00:00Z',
            hasToolUse: false,
            raw: {
              type: 'user',
              timestamp: '2026-07-15T10:00:00Z',
              message: { content: 'test' },
            },
          },
        ],
      },
    ];

    mockCreate.mockImplementationOnce(async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_candidates',
          input: {
            candidates: Array.from({ length: candidateCount }, (_, i) => ({
              category: 'mechanical_labor',
              text: `Candidate ${i}`,
              evidenceRef: `line:${i}`,
              evidenceSnippet: 'test',
            })),
          },
        },
      ],
    }));

    let sonnetCallCount = 0;
    mockCreate.mockImplementation(async (args: { tools?: Array<{ name: string }> }) => {
      if (args.tools?.[0]?.name === 'emit_candidates') {
        throw new Error('Unexpected second Haiku call');
      }
      sonnetCallCount++;
      if (sonnetCallCount === 1) {
        // First Sonnet batch fails
        throw new Error('boom');
      }
      // Second and third Sonnet batches succeed
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_insights',
            input: {
              insights: [
                {
                  episodeId: 1,
                  category: 'mechanical_labor',
                  text: `Insight from batch ${sonnetCallCount}`,
                  evidenceRef: `line:${sonnetCallCount}`,
                  significanceScore: 3,
                  effortClass: 'toil',
                  recurrenceOf: null,
                },
              ],
            },
          },
        ],
      };
    });

    const result = await runExtraction(episodes, db, client);

    expect(sonnetCallCount).toBe(3); // All three batches were attempted
    expect(result).toHaveLength(2); // Only insights from batches 2 and 3, batch 1 failed and contributed []
    expect(result[0].text).toContain('Insight from batch 2');
    expect(result[1].text).toContain('Insight from batch 3');
  });
});
