import type { EngagementBreakdown } from '../types';

interface Props {
  breakdown: EngagementBreakdown;
}

export function EngagementStatStrip({ breakdown }: Props) {
  const ratioValue =
    breakdown.engagementRatio === null ? 'N/A' : `${breakdown.engagementRatio.toFixed(1)}x`;
  const ratioLabel =
    breakdown.engagementRatio === null
      ? 'No babysitting detected'
      : 'Good engagement : babysitting';

  const stats = [
    { label: 'Classified Turns', value: String(breakdown.total), cls: '' },
    { label: ratioLabel, value: ratioValue, cls: 'judgment' },
    {
      label: 'Babysitting Turns',
      value: String(breakdown.directiveUnnecessary),
      cls: 'toil',
    },
    {
      label: 'Necessary Gates',
      value: String(breakdown.directiveNecessary),
      cls: 'overhead',
    },
    {
      label: 'Longest Babysitting Streak',
      value: String(breakdown.longestDirectiveBurst),
      cls: '',
    },
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
