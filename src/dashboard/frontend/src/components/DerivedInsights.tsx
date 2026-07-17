import type { DerivedInsight } from '../types';

interface Props {
  insights: DerivedInsight[];
}

const TYPE_LABELS: Record<DerivedInsight['insightType'], string> = {
  struggle: 'Struggle',
  win: 'Win',
  learning: 'Learning',
  idea: 'Idea',
  risk: 'Risk',
};

export function DerivedInsights({ insights }: Props) {
  if (insights.length === 0) {
    return (
      <div className="empty-state">
        No derived insights yet — click "Derive Insights" to synthesize them from this run's work
        items.
      </div>
    );
  }

  return (
    <ul className="insight-list">
      {insights.map((insight) => (
        <li className="insight-item" key={insight.id}>
          <div className="badge-row">
            <span className={`badge badge-derived ${insight.insightType}`}>
              {TYPE_LABELS[insight.insightType]}
            </span>
          </div>
          <div className="insight-text">{insight.text}</div>
          {insight.evidenceInsightIds.length > 0 && (
            <div className="insight-meta">
              Evidence: work item{insight.evidenceInsightIds.length > 1 ? 's' : ''}{' '}
              {insight.evidenceInsightIds.join(', ')}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
