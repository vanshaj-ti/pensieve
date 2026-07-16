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
import type { EffortBreakdownTrendPoint } from '../types';
import { EFFORT_COLORS, chartTextColor, chartGridColor } from '../chartTheme';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props {
  data: EffortBreakdownTrendPoint[];
}

export function EffortTrendChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="empty-state">No data in this window.</div>;
  }

  const dates = data.map((d) => d.date);
  const series = [
    { key: 'toilRatio' as const, label: 'Toil', color: EFFORT_COLORS.toil },
    { key: 'judgmentRatio' as const, label: 'Judgment', color: EFFORT_COLORS.judgment },
    { key: 'overheadRatio' as const, label: 'Overhead', color: EFFORT_COLORS.overhead },
  ];

  return (
    <div className="chart-container small">
      <Line
        data={{
          labels: dates,
          datasets: series.map((s) => ({
            label: s.label,
            data: data.map((d) => Number((d[s.key] * 100).toFixed(1))),
            borderColor: s.color,
            backgroundColor: s.color + '22',
            tension: 0.35,
            pointRadius: 2,
            borderWidth: 2,
            fill: false,
          })),
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
          },
          scales: {
            x: {
              grid: { color: chartGridColor() },
              ticks: { color: chartTextColor(), font: { size: 10 } },
            },
            y: {
              min: 0,
              max: 100,
              ticks: {
                callback: (v) => v + '%',
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
