import type { EngagementBreakdown } from '../types';
import { groupFlaggedDirectivesByTheme } from '../flaggedDirectiveThemes';

interface Props {
  breakdown: EngagementBreakdown;
}

/** Deliberately NOT an LLM call — this page reloads on every date-range
 * change, and a per-load API call would add real latency/cost for
 * something fully derivable from data already in hand. Plain rule-based
 * sentences from the same EngagementBreakdown fields the stat strip and
 * chart already render. */
function ratioSentence(breakdown: EngagementBreakdown): string {
  const { engagementRatio, deliberative, corrective } = breakdown;
  if (engagementRatio === null) {
    return 'No babysitting detected in this window — every human turn was either deliberative, corrective, or a necessary gate.';
  }
  if (engagementRatio >= 1.5) {
    return `You're engaging well — ${engagementRatio.toFixed(1)}x more deliberation and correction (${deliberative + corrective} turns) than unnecessary babysitting.`;
  }
  if (engagementRatio >= 0.7) {
    return `Roughly balanced — ${engagementRatio.toFixed(1)}x good engagement to babysitting. There's room to delegate more.`;
  }
  return `You're babysitting more than you're deliberating — only ${engagementRatio.toFixed(1)}x good engagement to babysitting turns.`;
}

function burstSentence(breakdown: EngagementBreakdown): string | null {
  if (breakdown.longestDirectiveBurst < 3) {
    return null;
  }
  return `Your longest babysitting streak was ${breakdown.longestDirectiveBurst} turns in a row — consider handing off a full task instead of micromanaging step by step.`;
}

function themeSentence(breakdown: EngagementBreakdown): string | null {
  const groups = groupFlaggedDirectivesByTheme(breakdown.flaggedDirectives);
  const top = groups[0];
  if (!top || top.count === 0) {
    return null;
  }
  return `Most common babysitting pattern: "${top.label}" (${top.count} of the flagged turns shown below).`;
}

function winsSentence(breakdown: EngagementBreakdown): string {
  const { deliberative, corrective } = breakdown;
  if (deliberative === 0 && corrective === 0) {
    return 'No deliberative or corrective turns recorded in this window.';
  }
  const parts: string[] = [];
  if (deliberative > 0) {
    parts.push(`resolved ${deliberative} genuine decision${deliberative === 1 ? '' : 's'}`);
  }
  if (corrective > 0) {
    parts.push(`caught ${corrective} real agent mistake${corrective === 1 ? '' : 's'}`);
  }
  return `What's going right: you ${parts.join(' and ')}.`;
}

export function EngagementSummary({ breakdown }: Props) {
  if (breakdown.total === 0) {
    return <div className="empty-state">No classified turns for this scope.</div>;
  }

  const sentences = [
    ratioSentence(breakdown),
    burstSentence(breakdown),
    themeSentence(breakdown),
    winsSentence(breakdown),
  ].filter((s): s is string => s !== null);

  return (
    <ul className="engagement-summary-list">
      {sentences.map((s, idx) => (
        <li key={idx}>{s}</li>
      ))}
    </ul>
  );
}
