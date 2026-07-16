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
                category: 'strategic_value',
                text: 'Important architecture decision',
                evidenceRef: 'line:1',
                evidenceSnippet: 'Test input',
              },
              {
                category: 'decision_record',
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
      category: 'strategic_value',
      text: 'Important architecture decision',
      evidenceRef: 'line:1',
      evidenceSnippet: 'Test input',
    });
    expect(result[1]).toEqual({
      category: 'decision_record',
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
                category: 'strategic_value',
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
            candidates: { category: 'strategic_value', text: 'not an array' },
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

  it('Case 3: Sonnet prompt includes candidates and recent history', async () => {
    const candidates: CandidateWithSource[] = [
      {
        episodeId: 1,
        candidate: {
          category: 'strategic_value',
          text: 'Candidate 1',
          evidenceRef: 'line:10',
          evidenceSnippet: 'snippet1',
        },
      },
      {
        episodeId: 2,
        candidate: {
          category: 'decision_record',
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
        category: 'strategic_value' as const,
        text: 'Previous insight',
        evidenceRef: 'line:5',
        significanceScore: 4,
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
    const userMessage = call.messages[0].content;
    expect(userMessage).toContain('Candidate 1');
    expect(userMessage).toContain('Candidate 2');
    expect(userMessage).toContain('Previous insight');
  });

  it('Case 4: Sonnet response parsing with recurrence field', async () => {
    const candidates: CandidateWithSource[] = [
      {
        episodeId: 1,
        candidate: {
          category: 'strategic_value',
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
                category: 'strategic_value',
                text: 'Polished insight',
                evidenceRef: 'line:15',
                significanceScore: 4,
                recurrenceOf: 100,
              },
              {
                episodeId: 1,
                category: 'decision_record',
                text: 'New decision',
                evidenceRef: 'line:16',
                significanceScore: 3,
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
      category: 'strategic_value',
      text: 'Polished insight',
      recurrenceOf: 100,
      verifiedByGit: null,
    });
    expect(result[1]).toMatchObject({
      episodeId: 1,
      category: 'decision_record',
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
            insights: { episodeId: 1, category: 'strategic_value', text: 'not an array' },
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
        verified_by_git INTEGER,
        recurrence_of INTEGER,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`
      INSERT INTO insights (episode_id, category, text, evidence_ref, significance_score, verified_by_git, recurrence_of, created_at)
      VALUES (99, 'strategic_value', 'Old insight', 'line:5', 4.0, NULL, NULL, '2026-07-14T10:00:00Z')
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
                category: 'ai_leverage',
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
                category: 'ai_leverage',
                text: 'Verified AI opportunity',
                evidenceRef: 'line:1',
                significanceScore: 4,
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
});
