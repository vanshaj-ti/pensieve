import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import type { EffortBreakdown, EffortByCategoryPoint } from '../types';
import { EFFORT_COLORS, chartTextColor } from '../chartTheme';

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  data: EffortBreakdown;
  byCategory: EffortByCategoryPoint[];
}

export function EffortBreakdownChart({ data, byCategory }: Props) {
  if (data.total === 0) {
    return <div className="empty-state">No work items for this scope.</div>;
  }

  const topTimeSink = [...byCategory].sort(
    (a, b) => b.toil + b.overhead - (a.toil + a.overhead),
  )[0];

  return (
    <>
      <div className="chart-container small">
        <Doughnut
          data={{
            labels: ['Toil', 'Judgment', 'Overhead'],
            datasets: [
              {
                data: [data.toil, data.judgment, data.overhead],
                backgroundColor: [
                  EFFORT_COLORS.toil,
                  EFFORT_COLORS.judgment,
                  EFFORT_COLORS.overhead,
                ],
                borderColor: 'transparent',
                borderWidth: 0,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: chartTextColor(), boxWidth: 10, font: { size: 11 }, padding: 14 },
              },
            },
          }}
        />
      </div>
      {topTimeSink && topTimeSink.toil + topTimeSink.overhead > 0 && (
        <div className="time-sink-callout">
          Biggest time-sink: <strong>{topTimeSink.category.replace(/_/g, ' ')}</strong> (
          {topTimeSink.toil} toil, {topTimeSink.overhead} overhead)
        </div>
      )}
    </>
  );
}
