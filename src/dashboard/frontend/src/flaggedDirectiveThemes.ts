import type { FlaggedDirective } from './types';

export type FlaggedDirectiveTheme =
  'manual-testing' | 'manual-code-review' | 'procedural-instruction' | 'redundant-order' | 'other';

export const THEME_LABELS: Record<FlaggedDirectiveTheme, string> = {
  'manual-testing': 'Manually ran/wrote tests instead of letting the agent',
  'manual-code-review': 'Manually reviewed code and specified exact fixes',
  'procedural-instruction': 'Gave step-by-step procedural instructions',
  'redundant-order': 'Repeated an instruction the agent was already following',
  other: 'Other',
};

/** Ordered so the first matching pattern wins — more specific themes
 * (manual-testing, manual-code-review) are checked before the broader
 * catch-alls (procedural-instruction, redundant-order), since a reason
 * mentioning both "ran tests" and "instructed" should land in the more
 * specific bucket. */
const THEME_PATTERNS: Array<{ theme: FlaggedDirectiveTheme; re: RegExp }> = [
  { theme: 'manual-testing', re: /\b(ran|running|wrote|added) tests?\b|manually ran/i },
  {
    theme: 'manual-code-review',
    re: /\bcode review\b|specified exact fixes|manually performed (the )?(code )?review/i,
  },
  { theme: 'redundant-order', re: /\balready\b.*\b(doing|proceeding|following|said)\b|redundant/i },
  { theme: 'procedural-instruction', re: /\btold agent\b|\binstructed\b|imperative/i },
];

export function classifyFlaggedDirective(reason: string): FlaggedDirectiveTheme {
  for (const { theme, re } of THEME_PATTERNS) {
    if (re.test(reason)) {
      return theme;
    }
  }
  return 'other';
}

export interface ThemeGroup {
  theme: FlaggedDirectiveTheme;
  label: string;
  count: number;
  examples: FlaggedDirective[];
}

const EXAMPLES_PER_THEME = 3;

/** Groups flagged directives by theme, ordered by count descending (the
 * biggest pattern first — that's the one worth fixing). */
export function groupFlaggedDirectivesByTheme(flaggedDirectives: FlaggedDirective[]): ThemeGroup[] {
  const byTheme = new Map<FlaggedDirectiveTheme, FlaggedDirective[]>();
  for (const f of flaggedDirectives) {
    const theme = classifyFlaggedDirective(f.reason);
    if (!byTheme.has(theme)) {
      byTheme.set(theme, []);
    }
    byTheme.get(theme)!.push(f);
  }

  return Array.from(byTheme.entries())
    .map(([theme, items]) => ({
      theme,
      label: THEME_LABELS[theme],
      count: items.length,
      examples: items.slice(0, EXAMPLES_PER_THEME),
    }))
    .sort((a, b) => b.count - a.count);
}
