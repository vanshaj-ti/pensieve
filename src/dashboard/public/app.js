let currentDate = null;
let effortBreakdownChart = null;
let categoryTrendChart = null;
let effortTrendChart = null;

async function fetchDates() {
  const res = await fetch('/api/dates');
  if (!res.ok) throw new Error('Failed to fetch dates');
  return res.json();
}

async function fetchCategoryTrend(days) {
  const res = await fetch(`/api/category-trend?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch category trend');
  return res.json();
}

async function fetchTopInsights(date, limit) {
  const res = await fetch(`/api/top-insights?date=${date}&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch top insights');
  return res.json();
}

async function fetchRecurrenceChains(days) {
  const res = await fetch(`/api/recurrence-chains?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch recurrence chains');
  return res.json();
}

async function fetchCrossProject(date) {
  const res = await fetch(`/api/cross-project?date=${date}`);
  if (!res.ok) throw new Error('Failed to fetch cross-project rollup');
  return res.json();
}

async function fetchEffortBreakdown(date) {
  const res = await fetch(`/api/effort-breakdown?date=${date}`);
  if (!res.ok) throw new Error('Failed to fetch effort breakdown');
  return res.json();
}

async function fetchEffortBreakdownTrend(days) {
  const res = await fetch(`/api/effort-breakdown-trend?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch effort breakdown trend');
  return res.json();
}

function renderEffortBreakdownChart(data) {
  const ctx = document.getElementById('effort-breakdown-chart').getContext('2d');
  if (effortBreakdownChart) {
    effortBreakdownChart.destroy();
  }
  effortBreakdownChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Toil', 'Judgment', 'Overhead'],
      datasets: [
        {
          data: [data.toil, data.judgment, data.overhead],
          backgroundColor: ['#ff6b6b', '#4ecdc4', '#ffd93d'],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
    },
  });
}

function renderCategoryTrendChart(data) {
  const ctx = document.getElementById('category-trend-chart').getContext('2d');
  if (categoryTrendChart) {
    categoryTrendChart.destroy();
  }

  const categories = [...new Set(data.map((d) => d.category))];
  const dates = [...new Set(data.map((d) => d.date))].sort();

  const colors = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#95e1d3', '#f38181'];

  const datasets = categories.map((cat, idx) => {
    const counts = dates.map((date) => {
      const point = data.find((d) => d.date === date && d.category === cat);
      return point ? point.count : 0;
    });
    return {
      label: cat,
      data: counts,
      borderColor: colors[idx % colors.length],
      backgroundColor: colors[idx % colors.length] + '33',
      tension: 0.4,
    };
  });

  categoryTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
          },
        },
      },
    },
  });
}

function renderEffortTrendChart(data) {
  const ctx = document.getElementById('effort-trend-chart').getContext('2d');
  if (effortTrendChart) {
    effortTrendChart.destroy();
  }

  const dates = data.map((d) => d.date);
  const toilRatios = data.map((d) => (d.toilRatio * 100).toFixed(1));
  const judgmentRatios = data.map((d) => (d.judgmentRatio * 100).toFixed(1));
  const overheadRatios = data.map((d) => (d.overheadRatio * 100).toFixed(1));

  effortTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'Toil %',
          data: toilRatios,
          borderColor: '#ff6b6b',
          backgroundColor: '#ff6b6b33',
          tension: 0.4,
        },
        {
          label: 'Judgment %',
          data: judgmentRatios,
          borderColor: '#4ecdc4',
          backgroundColor: '#4ecdc433',
          tension: 0.4,
        },
        {
          label: 'Overhead %',
          data: overheadRatios,
          borderColor: '#ffd93d',
          backgroundColor: '#ffd93d33',
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: {
            callback: function (value) {
              return value + '%';
            },
          },
        },
      },
    },
  });
}

function renderTopInsights(insights) {
  const container = document.getElementById('top-insights-container');
  if (insights.length === 0) {
    container.textContent = 'No insights for this date.';
    return;
  }

  const ul = document.createElement('ul');
  insights.forEach((insight) => {
    const li = document.createElement('li');

    const textDiv = document.createElement('div');
    textDiv.className = 'insight-text';
    const strong = document.createElement('strong');
    strong.textContent = insight.text;
    textDiv.appendChild(strong);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'insight-meta';
    metaDiv.textContent = `Category: ${insight.category} | Effort: ${insight.effortClass} | Significance: ${(insight.significanceScore * 100).toFixed(0)}% | Project: ${insight.projectDir}`;

    li.appendChild(textDiv);
    li.appendChild(metaDiv);
    ul.appendChild(li);
  });
  container.innerHTML = '';
  container.appendChild(ul);
}

function renderRecurrenceChains(chains) {
  const container = document.getElementById('recurrence-container');
  if (chains.length === 0) {
    container.textContent = 'No recurring patterns found.';
    return;
  }

  const ul = document.createElement('ul');
  chains.forEach((chain) => {
    const li = document.createElement('li');

    const textDiv = document.createElement('div');
    textDiv.className = 'insight-text';
    const strong = document.createElement('strong');
    strong.textContent = `Pattern (${chain.insights.length} recurrences)`;
    textDiv.appendChild(strong);

    const insightsDiv = document.createElement('div');
    insightsDiv.className = 'insight-meta';
    insightsDiv.textContent = chain.insights.map((i) => i.text).join(' → ');

    const spanDiv = document.createElement('div');
    spanDiv.className = 'insight-meta';
    spanDiv.textContent = `Span: ${chain.span.firstDate} to ${chain.span.lastDate}`;

    li.appendChild(textDiv);
    li.appendChild(insightsDiv);
    li.appendChild(spanDiv);
    ul.appendChild(li);
  });
  container.innerHTML = '';
  container.appendChild(ul);
}

function renderCrossProject(projects) {
  const container = document.getElementById('cross-project-container');
  const section = document.getElementById('cross-project-section');

  if (projects.length <= 1) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const projectHeader = document.createElement('th');
  projectHeader.textContent = 'Project';
  const countHeader = document.createElement('th');
  countHeader.textContent = 'Insights';
  headerRow.appendChild(projectHeader);
  headerRow.appendChild(countHeader);
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  projects.forEach((p) => {
    const row = document.createElement('tr');
    const projectCell = document.createElement('td');
    projectCell.textContent = p.projectDir;
    const countCell = document.createElement('td');
    countCell.textContent = p.insightCount;
    row.appendChild(projectCell);
    row.appendChild(countCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

async function loadAll(date) {
  currentDate = date;

  try {
    const [
      categoryTrend,
      topInsights,
      recurrenceChains,
      crossProject,
      effortBreakdown,
      effortTrend,
    ] = await Promise.all([
      fetchCategoryTrend(30),
      fetchTopInsights(date, 10),
      fetchRecurrenceChains(30),
      fetchCrossProject(date),
      fetchEffortBreakdown(date),
      fetchEffortBreakdownTrend(30),
    ]);

    renderEffortBreakdownChart(effortBreakdown);
    renderCategoryTrendChart(categoryTrend);
    renderEffortTrendChart(effortTrend);
    renderTopInsights(topInsights);
    renderRecurrenceChains(recurrenceChains);
    renderCrossProject(crossProject);
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const dates = await fetchDates();
    const picker = document.getElementById('date-picker');

    dates.forEach((date) => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = date;
      picker.appendChild(option);
    });

    if (dates.length > 0) {
      picker.value = dates[0];
      picker.addEventListener('change', (e) => loadAll(e.target.value));
      loadAll(dates[0]);
    }
  } catch (error) {
    console.error('Error initializing dashboard:', error);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    const msg = error instanceof Error ? error.message : 'Unknown error';
    errorDiv.textContent = `Failed to load dashboard: ${msg}`;
    document.body.textContent = '';
    document.body.appendChild(errorDiv);
  }
});
