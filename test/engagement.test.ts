import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn(),
  };
});

import Anthropic from '@anthropic-ai/sdk';
import {
  deriveTurnPairs,
  isAcknowledgment,
  looksLikeDirectiveHint,
  type TurnPair,
} from '../src/engagement/turns.js';
import { classifyTurns, EngagementClassificationError } from '../src/engagement/haiku.js';
import type { ParsedLine } from '../src/ingest/parser.js';
import type { EpisodeDraft } from '../src/chunk/episodes.js';

function userLine(
  lineNumber: number,
  text: string,
  timestamp = '2026-07-15T10:00:00Z',
): ParsedLine {
  return {
    lineNumber,
    type: 'user',
    timestamp,
    hasToolUse: false,
    raw: { type: 'user', timestamp, message: { content: text } },
  };
}

function toolResultLine(
  lineNumber: number,
  resultText: string,
  timestamp = '2026-07-15T10:00:00Z',
): ParsedLine {
  return {
    lineNumber,
    type: 'user',
    timestamp,
    hasToolUse: false,
    raw: {
      type: 'user',
      timestamp,
      message: { content: [{ type: 'tool_result', content: resultText }] },
    },
  };
}

function metaUserLine(
  lineNumber: number,
  text: string,
  timestamp = '2026-07-15T10:00:00Z',
): ParsedLine {
  return {
    lineNumber,
    type: 'user',
    timestamp,
    hasToolUse: false,
    raw: { type: 'user', timestamp, isMeta: true, message: { content: text } },
  };
}

function assistantLine(
  lineNumber: number,
  text: string,
  opts: { toolUse?: string; timestamp?: string } = {},
): ParsedLine {
  const timestamp = opts.timestamp ?? '2026-07-15T10:00:00Z';
  const content: unknown[] = [{ type: 'text', text }];
  if (opts.toolUse) {
    content.push({ type: 'tool_use', name: opts.toolUse, input: {} });
  }
  return {
    lineNumber,
    type: 'assistant',
    timestamp,
    hasToolUse: !!opts.toolUse,
    raw: { type: 'assistant', timestamp, message: { content } },
  };
}

describe('Engagement: turn-pair derivation', () => {
  it('Case 1: pairs a real human turn with the preceding agent turn', () => {
    const lines = [
      assistantLine(1, 'I fixed the bug. Should I also add a test?'),
      userLine(2, 'Yes, add a test.'),
    ];
    const pairs = deriveTurnPairs(lines);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].humanLineNumber).toBe(2);
    expect(pairs[0].humanTurnText).toBe('Yes, add a test.');
    expect(pairs[0].agentTurnText).toContain('Should I also add a test?');
    expect(pairs[0].agentAskedQuestion).toBe(true);
  });

  it('Case 2: a pure tool_result user line is NOT treated as a human turn', () => {
    const lines = [
      assistantLine(1, 'Running the tests now.', { toolUse: 'bash' }),
      toolResultLine(2, 'All 10 tests passed.'),
      userLine(3, 'Great, ship it.'),
    ];
    const pairs = deriveTurnPairs(lines);
    // Only line 3 is a real human turn; line 2 (tool_result) is folded into
    // the agent's own turn text, not paired as if the human wrote it.
    expect(pairs).toHaveLength(1);
    expect(pairs[0].humanLineNumber).toBe(3);
    expect(pairs[0].agentTurnText).toContain('Running the tests now');
    expect(pairs[0].agentTurnText).toContain('All 10 tests passed');
    expect(pairs[0].agentHadToolAccess).toBe(true);
  });

  it('Case 2b: a harness-injected <task-notification> user line is NOT treated as a human turn (regression)', () => {
    // Real bug found live via this feature's own spot-check output:
    // Claude Code injects background-task notifications and system
    // reminders as ordinary `type: 'user'` JSONL lines with real text
    // content — same shape as a genuine human message. Without this
    // filter, ~357 of these were misclassified as human turns in a single
    // real session.
    const lines = [
      assistantLine(1, 'Running the tests now.', { toolUse: 'bash' }),
      userLine(
        2,
        '<task-notification>\n<task-id>abc123</task-id>\n<status>completed</status>\n</task-notification>',
      ),
      userLine(3, 'Great, ship it.'),
    ];
    const pairs = deriveTurnPairs(lines);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].humanLineNumber).toBe(3);
    expect(pairs[0].agentTurnText).toContain('task-notification');
  });

  it('Case 2c: a "[SYSTEM NOTIFICATION" preamble is NOT treated as a human turn', () => {
    const lines = [
      assistantLine(1, 'Waiting on the background job.'),
      userLine(2, '[SYSTEM NOTIFICATION - NOT USER INPUT]\nThe job finished.'),
      userLine(3, 'Thanks, continue.'),
    ];
    const pairs = deriveTurnPairs(lines);
    // Only the real ack at line 3 is a human turn (folded system content
    // stays in the agent cluster for context).
    expect(pairs).toHaveLength(1);
    expect(pairs[0].humanLineNumber).toBe(3);
  });

  it('Case 2d: an isMeta:true line (stop-hook feedback) is NOT treated as a human turn (regression)', () => {
    // Real bug: found live in the brief output — a stop-hook-feedback turn
    // ("Stop hook feedback:\nAgent hook condition was not met...") doesn't
    // start with any of SYSTEM_INJECTED_RE's string markers, but Claude
    // Code's own JSONL flags it (and <system-reminder>/<local-command-
    // caveat> blocks, slash-command re-invocations) with isMeta: true —
    // a structural signal, checked independently of content text.
    const lines = [
      assistantLine(1, 'Dispatching task 4.'),
      metaUserLine(
        2,
        'Stop hook feedback:\nAgent hook condition was not met: WIP tasks remain: [4].',
      ),
      userLine(3, 'Continue with task 5.'),
    ];
    const pairs = deriveTurnPairs(lines);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].humanLineNumber).toBe(3);
    expect(pairs[0].agentTurnText).toContain('Stop hook feedback');
  });

  it('Case 3: a human turn with no preceding agent activity is skipped', () => {
    const lines = [userLine(1, 'Let’s start building the feature.')];
    const pairs = deriveTurnPairs(lines);
    expect(pairs).toHaveLength(0);
  });

  it('Case 4: multiple consecutive human turns each pair with the nearest preceding agent cluster', () => {
    const lines = [
      assistantLine(1, 'Done with task A.'),
      userLine(2, 'Now do task B.'),
      assistantLine(3, 'Done with task B.'),
      userLine(4, 'Now do task C.'),
    ];
    const pairs = deriveTurnPairs(lines);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].humanLineNumber).toBe(2);
    expect(pairs[0].agentTurnText).toContain('task A');
    expect(pairs[1].humanLineNumber).toBe(4);
    expect(pairs[1].agentTurnText).toContain('task B');
  });

  it('Case 5: agentAskedQuestion is false when the agent turn has no question', () => {
    const lines = [assistantLine(1, 'I finished implementing the feature.'), userLine(2, 'Great.')];
    const pairs = deriveTurnPairs(lines);
    expect(pairs[0].agentAskedQuestion).toBe(false);
  });
});

describe('Engagement: stage-0 heuristics', () => {
  it('Case 6: short acknowledgments are detected', () => {
    expect(isAcknowledgment('yes')).toBe(true);
    expect(isAcknowledgment('LGTM')).toBe(true);
    expect(isAcknowledgment('continue')).toBe(true);
    expect(isAcknowledgment('Looks good, thanks!')).toBe(true);
  });

  it('Case 7: long messages are never treated as acknowledgments even if they start with an ack word', () => {
    const long =
      'Yes, but before you continue, make sure to also check whether the migration handles the null case correctly since we saw a bug there last time.';
    expect(isAcknowledgment(long)).toBe(false);
  });

  it('Case 8: substantive direction is not an acknowledgment', () => {
    expect(isAcknowledgment('Use approach B because of the latency constraint.')).toBe(false);
  });

  it('Case 9: code blocks and shell commands are flagged as directive hints', () => {
    expect(looksLikeDirectiveHint('```\nnpm test\n```')).toBe(true);
    expect(looksLikeDirectiveHint('git commit -m "fix"')).toBe(true);
    expect(looksLikeDirectiveHint('I think we should use approach B.')).toBe(false);
  });
});

describe('Engagement: Haiku classification pass', () => {
  let client: Anthropic;
  let mockCreate: ReturnType<typeof vi.fn>;
  const episode: EpisodeDraft = {
    date: '2026-07-15',
    projectDir: '/test/project',
    sessionId: 'session-1',
    startLine: 1,
    endLine: 10,
    lines: [],
  };

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

  function pair(humanLineNumber: number, humanTurnText: string): TurnPair {
    return {
      episodeLineStart: humanLineNumber - 1,
      agentTurnText: 'Investigating the issue.',
      agentAskedQuestion: false,
      agentHadToolAccess: true,
      humanLineNumber,
      humanTurnText,
    };
  }

  it('Case 10: acknowledgments are filtered before any Haiku call', async () => {
    const pairs = [pair(2, 'yes')];
    const result = await classifyTurns(episode, pairs, client);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        humanLineNumber: 2,
        classification: 'acknowledgment',
        directiveNecessary: null,
        reason: 'low-content acknowledgment, filtered before classification',
      },
    ]);
  });

  it('Case 11: Haiku response parsing creates valid EngagementCandidate objects', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_engagement_classifications',
          input: {
            candidates: [
              {
                humanLineNumber: 2,
                classification: 'directive',
                directiveNecessary: false,
                reason: 'ran tests manually, agent already had shell access',
              },
            ],
          },
        },
      ],
    });

    const pairs = [pair(2, 'run the tests and tell me the output')];
    const result = await classifyTurns(episode, pairs, client);
    expect(result).toEqual([
      {
        humanLineNumber: 2,
        classification: 'directive',
        directiveNecessary: false,
        reason: 'ran tests manually, agent already had shell access',
      },
    ]);
  });

  it('Case 12: schema violation in Haiku response skips the bad candidate, keeps the rest', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'emit_engagement_classifications',
          input: {
            candidates: [
              { humanLineNumber: 2, classification: 'not_a_real_category', reason: 'bad' },
              {
                humanLineNumber: 3,
                classification: 'deliberative',
                directiveNecessary: null,
                reason: 'answered the agent design question',
              },
            ],
          },
        },
      ],
    });

    const pairs = [pair(2, 'why does this fail'), pair(3, 'use approach B')];
    const result = await classifyTurns(episode, pairs, client);
    expect(result).toEqual([
      {
        humanLineNumber: 3,
        classification: 'deliberative',
        directiveNecessary: null,
        reason: 'answered the agent design question',
      },
    ]);
  });

  it('Case 13: max_tokens truncation bisects the batch and retries both halves', async () => {
    const pairs = Array.from({ length: 10 }, (_, i) => pair(i + 2, `turn ${i}`));

    mockCreate.mockResolvedValueOnce({
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', name: 'emit_engagement_classifications', input: {} }],
    });
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'tool_use',
          name: 'emit_engagement_classifications',
          input: {
            candidates: [
              {
                humanLineNumber: 2,
                classification: 'directive',
                directiveNecessary: false,
                reason: 'first half',
              },
            ],
          },
        },
      ],
    });
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'tool_use',
          name: 'emit_engagement_classifications',
          input: {
            candidates: [
              {
                humanLineNumber: 7,
                classification: 'deliberative',
                directiveNecessary: null,
                reason: 'second half',
              },
            ],
          },
        },
      ],
    });

    const result = await classifyTurns(episode, pairs, client);
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result).toEqual([
      {
        humanLineNumber: 2,
        classification: 'directive',
        directiveNecessary: false,
        reason: 'first half',
      },
      {
        humanLineNumber: 7,
        classification: 'deliberative',
        directiveNecessary: null,
        reason: 'second half',
      },
    ]);
  });

  it('Case 14: total classification failure throws EngagementClassificationError', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'no tool use here' }],
    });
    const pairs = [pair(2, 'run the tests')];
    await expect(classifyTurns(episode, pairs, client)).rejects.toThrow(
      EngagementClassificationError,
    );
  });
});

describe('Engagement: orchestrator dedup', () => {
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

  it('Case 15: two classifications for the same human line in one response are deduped, keeping the first (regression)', async () => {
    // Real bug found live: a single Haiku tool_use response emitted two
    // candidates with the same humanLineNumber (confirmed via identical
    // episode_id/human_line_number/created_at in the persisted rows —
    // not a bisection re-run, which never overlaps its own slices).
    const { runEngagementAnalysis } = await import('../src/engagement/index.js');
    const episode: EpisodeDraft = {
      date: '2026-07-15',
      projectDir: '/test/project',
      sessionId: 'session-1',
      startLine: 1,
      endLine: 5,
      lines: [assistantLine(1, 'Should I use approach A or B?'), userLine(2, 'Use approach B.')],
    };
    const persistedEpisode = { ...episode, id: 42 };

    mockCreate.mockResolvedValueOnce({
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
                reason: 'first classification',
              },
              {
                humanLineNumber: 2,
                classification: 'directive',
                directiveNecessary: false,
                reason: 'duplicate classification for the same line',
              },
            ],
          },
        },
      ],
    });

    const result = await runEngagementAnalysis([persistedEpisode], {} as never, client);
    expect(result).toEqual([
      {
        humanLineNumber: 2,
        classification: 'deliberative',
        directiveNecessary: null,
        reason: 'first classification',
        episodeId: 42,
      },
    ]);
  });
});
