import type { EffortBreakdown, TopInsight } from '../types';

interface Props {
  effortBreakdown: EffortBreakdown;
  topInsights: TopInsight[];
}

export function StatStrip({ effortBreakdown, topInsights }: Props) {
  const topScore = topInsights.length > 0 ? topInsights[0].significanceScore.toFixed(1) : '—';

  const stats = [
    { label: 'Insights', value: String(effortBreakdown.total), cls: '' },
    {
      label: 'Judgment',
      value: `${Math.round(effortBreakdown.judgmentRatio * 100)}%`,
      cls: 'judgment',
    },
    { label: 'Toil', value: `${Math.round(effortBreakdown.toilRatio * 100)}%`, cls: 'toil' },
    {
      label: 'Overhead',
      value: `${Math.round(effortBreakdown.overheadRatio * 100)}%`,
      cls: 'overhead',
    },
    { label: 'Top significance', value: topScore, cls: '' },
  ];

  return (
    <div className="stat-strip">
      {stats.map((s) => (
        <div className="stat-card" key={s.label}>
          <div className="stat-label">{s.label}</div>
          <div className={`stat-value ${s.cls}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
