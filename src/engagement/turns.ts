import type { ParsedLine } from '../ingest/parser.js';
import { renderMessageContent } from '../ingest/content.js';

/**
 * One (preceding agent turn-cluster, real human turn) pair, the unit the
 * engagement classifier operates on. A `ParsedLine` with `type: 'user'` is
 * NOT always a real human turn — Claude Code nests tool_result blocks
 * inside `user`-role messages, so a `user` line whose content is entirely
 * tool_result blocks (no text) is the agent's own tool output being echoed
 * back, not something the human typed. deriveTurnPairs filters those out.
 */
export interface TurnPair {
  episodeLineStart: number;
  agentTurnText: string;
  agentAskedQuestion: boolean;
  agentHadToolAccess: boolean;
  humanLineNumber: number;
  humanTurnText: string;
}

const QUESTION_OR_OPTIONS_RE = /\?\s*$|^\s*(?:options?|choices?)\s*:/im;

function agentClusterAskedQuestion(text: string): boolean {
  return QUESTION_OR_OPTIONS_RE.test(text.trim());
}

/** Claude Code's harness injects system content as `user`-role turns —
 * <task-notification>/<system-reminder> blocks, "[SYSTEM NOTIFICATION -
 * NOT USER INPUT]" preambles, background-task completion notices. These
 * are NOT the human typing anything; a real production bug (found via this
 * feature's own spot-check output) was classifying these as genuine human
 * turns, since they arrive as ordinary `type: 'user'` JSONL lines with real
 * text content — the same shape as an actual human message, just
 * machine-generated. Detected by a leading marker rather than requiring
 * the ENTIRE turn to be system content, since a human's real message can
 * arrive bundled with a trailing system-reminder in the same turn (as seen
 * in this same transcript) — only the isolated, system-only case is
 * filtered here. */
const SYSTEM_INJECTED_RE = /^\s*(?:<task-notification>|<system-reminder>|\[SYSTEM NOTIFICATION\b)/i;

function isSystemInjectedTurn(text: string): boolean {
  return SYSTEM_INJECTED_RE.test(text);
}

/** Claude Code's own JSONL marks harness-injected content (stop-hook
 * feedback, <system-reminder>/<local-command-caveat> blocks, slash-command
 * re-invocations) with `isMeta: true` on the raw line object itself — a
 * structural signal, more reliable than text pattern matching. Found via
 * this feature's own brief output still showing a stop-hook-feedback turn
 * ("Stop hook feedback:\nAgent hook condition was not met...") as a
 * flagged babysitting turn after the SYSTEM_INJECTED_RE fix: that content
 * doesn't start with any of the string markers SYSTEM_INJECTED_RE checks,
 * but IS isMeta-flagged. Confirmed NOT redundant with SYSTEM_INJECTED_RE —
 * <task-notification> content is NOT isMeta-flagged at all (a different
 * injection mechanism), so both checks are needed, neither subsumes the
 * other. */
function isMetaLine(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'isMeta' in raw &&
    (raw as { isMeta: unknown }).isMeta === true
  );
}

/**
 * Groups a flat, still-interleaved `ParsedLine[]` (as stored on
 * `EpisodeDraft.lines`) into turn pairs: each real human turn paired with
 * the immediately-preceding run of assistant activity (consecutive
 * `assistant` lines, plus any interleaved `user` lines that are pure
 * tool_result echoes — those belong to the agent's own turn, not the
 * human's). Human turns with no preceding assistant activity (session
 * start) are skipped — there's nothing to classify against.
 */
export function deriveTurnPairs(lines: ParsedLine[]): TurnPair[] {
  const pairs: TurnPair[] = [];

  let clusterStartLine: number | null = null;
  let clusterTextParts: string[] = [];
  let clusterHadToolUse = false;
  let sawAnyAgentActivity = false;

  for (const line of lines) {
    const rendered = renderMessageContent(line.raw);

    if (line.type === 'assistant') {
      if (clusterStartLine === null) {
        clusterStartLine = line.lineNumber;
      }
      if (rendered.content) {
        clusterTextParts.push(rendered.content);
      }
      if (rendered.hasToolUse || line.hasToolUse) {
        clusterHadToolUse = true;
      }
      sawAnyAgentActivity = true;
      continue;
    }

    // line.type === 'user'
    if (!rendered.hasText || isSystemInjectedTurn(rendered.content) || isMetaLine(line.raw)) {
      // Pure tool_result echo, or a harness-injected system notification
      // (<task-notification>, <system-reminder>, background-task
      // completion notices, stop-hook feedback) — neither is the human
      // typing anything, both belong to the agent's own turn context, not
      // something to pair against as a human contribution.
      if (clusterStartLine === null) {
        clusterStartLine = line.lineNumber;
      }
      if (rendered.content) {
        clusterTextParts.push(rendered.content);
      }
      continue;
    }

    // Real human turn.
    if (sawAnyAgentActivity && clusterStartLine !== null) {
      const agentTurnText = clusterTextParts.join('\n');
      pairs.push({
        episodeLineStart: clusterStartLine,
        agentTurnText,
        agentAskedQuestion: agentClusterAskedQuestion(agentTurnText),
        agentHadToolAccess: clusterHadToolUse,
        humanLineNumber: line.lineNumber,
        humanTurnText: rendered.content,
      });
    }

    // Reset for the next agent cluster.
    clusterStartLine = null;
    clusterTextParts = [];
    clusterHadToolUse = false;
  }

  return pairs;
}

const ACK_PHRASE = String.raw`yes|yep|yeah|ok|okay|sure|sounds good|looks good|lgtm|great|thanks|thank you|perfect|continue|go ahead|do it|proceed|approved?|good|nice|cool`;
// Allows a short sequence of ack phrases joined by punctuation ("Looks
// good, thanks!") without opening the door to substantive sentences —
// each segment between separators must itself be a bare ack phrase.
const ACK_RE = new RegExp(`^(?:(?:${ACK_PHRASE})[.,!\\s]*)+$`, 'i');

/** True if this looks like a low-content acknowledgment — filtered out of
 * the classification pipeline entirely (never scored as babysitting or
 * good engagement, since it's neither). */
export function isAcknowledgment(humanTurnText: string): boolean {
  const trimmed = humanTurnText.trim();
  if (trimmed.split(/\s+/).length >= 15) {
    return false;
  }
  return ACK_RE.test(trimmed);
}

const CODE_BLOCK_RE = /```/;
const SHELL_COMMAND_RE =
  /^\s*[$#]?\s*(?:npm|git|curl|cd|ls|cat|grep|sed|awk|python3?|node|rm|mkdir)\s/im;

/** Cheap, free-to-compute hint that this turn is very likely `directive` —
 * the human pasted/typed code or a raw shell command rather than
 * describing intent. Still passed through the Haiku classifier (as a
 * hint field), not treated as final — see stage-0 pre-filter design. */
export function looksLikeDirectiveHint(humanTurnText: string): boolean {
  return CODE_BLOCK_RE.test(humanTurnText) || SHELL_COMMAND_RE.test(humanTurnText);
}
