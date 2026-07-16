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
import type { CategoryTrendPoint } from '../types';
import { CATEGORY_COLORS, chartTextColor, chartGridColor } from '../chartTheme';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props {
  data: CategoryTrendPoint[];
}

export function CategoryTrendChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="empty-state">No data in this window.</div>;
  }

  const categories = [...new Set(data.map((d) => d.category))];
  const dates = [...new Set(data.map((d) => d.date))].sort();

  const datasets = categories.map((cat, idx) => {
    const counts = dates.map((date) => {
      const point = data.find((d) => d.date === date && d.category === cat);
      return point ? point.count : 0;
    });
    const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
    return {
      label: cat.replace(/_/g, ' '),
      data: counts,
      borderColor: color,
      backgroundColor: color + '22',
      tension: 0.35,
      pointRadius: 2,
      borderWidth: 2,
      fill: false,
    };
  });

  return (
    <div className="chart-container">
      <Line
        data={{ labels: dates, datasets }}
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
              beginAtZero: true,
              ticks: { stepSize: 1, color: chartTextColor(), font: { size: 10 } },
              grid: { color: chartGridColor() },
            },
          },
        }}
      />
    </div>
  );
}
