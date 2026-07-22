import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import type { EngagementBreakdownTrendPoint } from '../types';
import { ENGAGEMENT_COLORS, chartTextColor, chartGridColor } from '../chartTheme';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props {
  data: EngagementBreakdownTrendPoint[];
}

export function EngagementTrendChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="empty-state">No data in this window.</div>;
  }

  const dates = data.map((d) => d.date);

  return (
    <div className="chart-container small">
      <Line
        data={{
          labels: dates,
          datasets: [
            {
              label: 'Good engagement : babysitting ratio',
              // null (not 0) when there's no babysitting to divide by that
              // day — plotting 0 would read as "babysitting-heavy day",
              // the opposite of what a null ratio means. spanGaps:false
              // below renders these as a visible break in the line rather
              // than a false zero or a misleading straight interpolation.
              data: data.map((d) => d.engagementRatio),
              borderColor: ENGAGEMENT_COLORS.deliberative,
              backgroundColor: ENGAGEMENT_COLORS.deliberative + '22',
              tension: 0.35,
              pointRadius: 3,
              borderWidth: 2,
              fill: false,
              spanGaps: false,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: chartTextColor(), boxWidth: 10, font: { size: 11 }, padding: 14 },
            },
            tooltip: {
              callbacks: {
                label: (ctx) =>
                  ctx.parsed.y === null
                    ? 'No babysitting that day'
                    : `${ctx.parsed.y.toFixed(1)}x good engagement : babysitting`,
              },
            },
          },
          scales: {
            x: {
              grid: { color: chartGridColor() },
              ticks: { color: chartTextColor(), font: { size: 10 } },
            },
            y: {
              min: 0,
              ticks: {
                callback: (v) => `${v}x`,
                color: chartTextColor(),
                font: { size: 10 },
              },
              grid: { color: chartGridColor() },
            },
          },
        }}
      />
    </div>
  );
}
