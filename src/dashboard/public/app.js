let currentDate = null;
let effortBreakdownChart = null;
let categoryTrendChart = null;
let effortTrendChart = null;

const EFFORT_COLORS = { toil: '#e8785a', judgment: '#4bab8c', overhead: '#e0b03e' };
const CATEGORY_COLORS = ['#5b5bd6', '#4bab8c', '#e8785a', '#e0b03e', '#6b9bd6', '#c46bd6'];

function isDarkMode() {
  const themeAttr = document.documentElement.getAttribute('data-theme');
  if (themeAttr === 'dark') return true;
  if (themeAttr === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function chartTextColor() {
  return isDarkMode() ? '#a3a3ad' : '#6b6b73';
}

function chartGridColor() {
  return isDarkMode() ? '#2a2a33' : '#e5e5e8';
}

async function fetchJson(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${label}`);
  return res.json();
}

const fetchDates = () => fetchJson('/api/dates', 'dates');
const fetchCategoryTrend = (days) =>
  fetchJson(`/api/category-trend?days=${days}`, 'category trend');
const fetchTopInsights = (date, limit) =>
  fetchJson(`/api/top-insights?date=${date}&limit=${limit}`, 'top insights');
const fetchRecurrenceChains = (days) =>
  fetchJson(`/api/recurrence-chains?days=${days}`, 'recurrence chains');
const fetchCrossProject = (date) =>
  fetchJson(`/api/cross-project?date=${date}`, 'cross-project rollup');
const fetchEffortBreakdown = (date) =>
  fetchJson(`/api/effort-breakdown?date=${date}`, 'effort breakdown');
const fetchEffortBreakdownTrend = (days) =>
  fetchJson(`/api/effort-breakdown-trend?days=${days}`, 'effort breakdown trend');

function renderStatStrip(effortBreakdown, topInsights) {
  const strip = document.getElementById('stat-strip');
  const topScore = topInsights.length > 0 ? topInsights[0].significanceScore.toFixed(1) : '—';

  const stats = [
    { label: 'Insights today', value: effortBreakdown.total, cls: '' },
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

  strip.innerHTML = '';
  stats.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = s.label;
    const value = document.createElement('div');
    value.className = `stat-value ${s.cls}`;
    value.textContent = s.value;
    card.appendChild(label);
    card.appendChild(value);
    strip.appendChild(card);
  });
}

function renderEffortBreakdownChart(data) {
  const ctx = document.getElementById('effort-breakdown-chart').getContext('2d');
  if (effortBreakdownChart) effortBreakdownChart.destroy();

  if (data.total === 0) {
    ctx.canvas.parentElement.innerHTML =
      '<div class="empty-state">No insights for this date.</div>';
    return;
  }

  effortBreakdownChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Toil', 'Judgment', 'Overhead'],
      datasets: [
        {
          data: [data.toil, data.judgment, data.overhead],
          backgroundColor: [EFFORT_COLORS.toil, EFFORT_COLORS.judgment, EFFORT_COLORS.overhead],
          borderColor: 'transparent',
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: chartTextColor(), boxWidth: 10, font: { size: 11 }, padding: 14 },
        },
      },
    },
  });
}

function renderCategoryTrendChart(data) {
  const ctx = document.getElementById('category-trend-chart').getContext('2d');
  if (categoryTrendChart) categoryTrendChart.destroy();

  if (data.length === 0) {
    ctx.canvas.parentElement.innerHTML = '<div class="empty-state">No data in this window.</div>';
    return;
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

  categoryTrendChart = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
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
    },
  });
}

function renderEffortTrendChart(data) {
  const ctx = document.getElementById('effort-trend-chart').getContext('2d');
  if (effortTrendChart) effortTrendChart.destroy();

  if (data.length === 0) {
    ctx.canvas.parentElement.innerHTML = '<div class="empty-state">No data in this window.</div>';
    return;
  }

  const dates = data.map((d) => d.date);
  const series = [
    { key: 'toilRatio', label: 'Toil', color: EFFORT_COLORS.toil },
    { key: 'judgmentRatio', label: 'Judgment', color: EFFORT_COLORS.judgment },
    { key: 'overheadRatio', label: 'Overhead', color: EFFORT_COLORS.overhead },
  ];

  effortTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: series.map((s) => ({
        label: s.label,
        data: data.map((d) => (d[s.key] * 100).toFixed(1)),
        borderColor: s.color,
        backgroundColor: s.color + '22',
        tension: 0.35,
        pointRadius: 2,
        borderWidth: 2,
        fill: false,
      })),
    },
    options: {
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
          ticks: { callback: (v) => v + '%', color: chartTextColor(), font: { size: 10 } },
          grid: { color: chartGridColor() },
        },
      },
    },
  });
}

function badgeRow(insight) {
  const row = document.createElement('div');
  row.className = 'badge-row';

  const cat = document.createElement('span');
  cat.className = 'badge badge-category';
  cat.textContent = insight.category.replace(/_/g, ' ');
  row.appendChild(cat);

  const effort = document.createElement('span');
  effort.className = `badge badge-effort ${insight.effortClass}`;
  effort.textContent = insight.effortClass;
  row.appendChild(effort);

  const score = document.createElement('span');
  score.className = 'badge badge-score';
  score.textContent = `sig ${insight.significanceScore.toFixed(1)}`;
  row.appendChild(score);

  return row;
}

function renderTopInsights(insights) {
  const container = document.getElementById('top-insights-container');
  container.innerHTML = '';

  if (insights.length === 0) {
    container.innerHTML = '<div class="empty-state">No insights for this date.</div>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'insight-list';
  insights.forEach((insight) => {
    const li = document.createElement('li');
    li.className = 'insight-item';

    const textDiv = document.createElement('div');
    textDiv.className = 'insight-text';
    textDiv.textContent = insight.text;
    li.appendChild(textDiv);
    li.appendChild(badgeRow(insight));

    if (insight.projectDir) {
      const proj = document.createElement('div');
      proj.className = 'insight-project';
      proj.textContent = insight.projectDir;
      li.appendChild(proj);
    }

    ul.appendChild(li);
  });
  container.appendChild(ul);
}

function renderRecurrenceChains(chains) {
  const container = document.getElementById('recurrence-container');
  container.innerHTML = '';

  if (chains.length === 0) {
    container.innerHTML = '<div class="empty-state">No recurring patterns found.</div>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'insight-list';
  chains.forEach((chain) => {
    const li = document.createElement('li');
    li.className = 'chain-item';

    const title = document.createElement('div');
    title.className = 'chain-title';
    title.textContent = `Recurred ${chain.insights.length}×`;
    li.appendChild(title);

    const path = document.createElement('div');
    path.className = 'chain-path';
    path.textContent = chain.insights.map((i) => i.text).join(' → ');
    li.appendChild(path);

    const span = document.createElement('div');
    span.className = 'chain-span';
    span.textContent = `${chain.span.firstDate} → ${chain.span.lastDate}`;
    li.appendChild(span);

    ul.appendChild(li);
  });
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
  container.innerHTML = '';

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Project</th><th>Insights</th></tr></thead>';
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

    renderStatStrip(effortBreakdown, topInsights);
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

    if (dates.length === 0) {
      document.querySelector('main').innerHTML =
        '<div class="empty-state" style="grid-column: 1 / -1;">No data yet — run `pensieve analyze` first.</div>';
      document.getElementById('stat-strip').style.display = 'none';
      picker.style.display = 'none';
      return;
    }

    dates.forEach((date) => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = date;
      picker.appendChild(option);
    });

    picker.value = dates[0];
    picker.addEventListener('change', (e) => loadAll(e.target.value));
    loadAll(dates[0]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    document.body.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `Failed to load dashboard: ${msg}`;
    document.body.appendChild(banner);
  }
});
