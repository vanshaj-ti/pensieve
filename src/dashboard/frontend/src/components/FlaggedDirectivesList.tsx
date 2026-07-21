import type { FlaggedDirective } from '../types';

interface Props {
  flaggedDirectives: FlaggedDirective[];
}

export function FlaggedDirectivesList({ flaggedDirectives }: Props) {
  if (flaggedDirectives.length === 0) {
    return <div className="empty-state">No babysitting turns flagged for this scope.</div>;
  }

  return (
    <ul className="flagged-directives-list">
      {flaggedDirectives.map((f) => (
        <li key={f.humanLineNumber} className="flagged-directive-item">
          <span className="flagged-directive-line">line {f.humanLineNumber}</span>
          <span className="flagged-directive-reason">{f.reason}</span>
        </li>
      ))}
    </ul>
  );
}
