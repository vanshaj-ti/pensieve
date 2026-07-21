import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import type { EngagementBreakdown } from '../types';
import { ENGAGEMENT_COLORS, chartTextColor } from '../chartTheme';

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  data: EngagementBreakdown;
}

export function EngagementBreakdownChart({ data }: Props) {
  if (data.total === 0) {
    return <div className="empty-state">No classified turns for this scope.</div>;
  }

  return (
    <div className="chart-container small">
      <Doughnut
        data={{
          labels: [
            'Deliberative',
            'Corrective',
            'Babysitting (unnecessary)',
            'Necessary gate',
            'Acknowledgment',
          ],
          datasets: [
            {
              data: [
                data.deliberative,
                data.corrective,
                data.directiveUnnecessary,
                data.directiveNecessary,
                data.acknowledgment,
              ],
              backgroundColor: [
                ENGAGEMENT_COLORS.deliberative,
                ENGAGEMENT_COLORS.corrective,
                ENGAGEMENT_COLORS.directiveUnnecessary,
                ENGAGEMENT_COLORS.directiveNecessary,
                ENGAGEMENT_COLORS.acknowledgment,
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
  );
}
