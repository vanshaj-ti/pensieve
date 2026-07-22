import type { FlaggedDirective } from '../types';
import { groupFlaggedDirectivesByTheme } from '../flaggedDirectiveThemes';

interface Props {
  flaggedDirectives: FlaggedDirective[];
}

/** Groups by inferred theme instead of a flat dump — a session with
 * several near-identical "manually ran tests" turns used to show every
 * one of them as separate list items with the same text repeated
 * (user feedback: "why 3 of the same... I don't need to see these").
 * Each theme collapses to its count + a couple of examples, expandable
 * for the rest. */
export function FlaggedDirectivesList({ flaggedDirectives }: Props) {
  if (flaggedDirectives.length === 0) {
    return <div className="empty-state">No babysitting turns flagged for this scope.</div>;
  }

  const groups = groupFlaggedDirectivesByTheme(flaggedDirectives);

  return (
    <ul className="flagged-theme-list">
      {groups.map((group) => (
        <li key={group.theme} className="flagged-theme-item">
          <div className="flagged-theme-header">
            <span className="flagged-theme-label">{group.label}</span>
            <span className="badge badge-score">
              {group.count} turn{group.count === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="flagged-directives-list">
            {group.examples.map((f, idx) => (
              // humanLineNumber is not unique across a multi-day session
              // (real bug found live: React "duplicate key" warning). Index
              // is stable here since the group is derived fresh per render.
              <li key={`${f.humanLineNumber}-${idx}`} className="flagged-directive-item">
                <span className="flagged-directive-line">line {f.humanLineNumber}</span>
                <span className="flagged-directive-reason">{f.reason}</span>
              </li>
            ))}
          </ul>
          {group.count > group.examples.length && (
            <div className="flagged-theme-more">
              +{group.count - group.examples.length} more like this
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
