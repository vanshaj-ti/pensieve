import type {
  AnalyticsFilter,
  AnalyzeJob,
  CategoryTrendPoint,
  PaginatedSessions,
  SessionProject,
  EffortBreakdown,
  EffortBreakdownTrendPoint,
  EffortByCategoryPoint,
  LabelSummary,
  ProjectRollup,
  ProjectSummary,
  RecurrenceChain,
  SessionRun,
  SessionSummary,
  TopInsight,
} from './types';

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${label}`);
  return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | number | undefined> | AnalyticsFilter): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      usp.set(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export const fetchDates = (filter: AnalyticsFilter = {}) =>
  fetchJson<string[]>(`/api/dates${buildQuery(filter)}`, 'dates');

export const fetchCategoryTrend = (days: number, filter: AnalyticsFilter = {}) =>
  fetchJson<CategoryTrendPoint[]>(
    `/api/category-trend${buildQuery({ days, ...filter })}`,
    'category trend',
  );

export const fetchTopInsights = (date: string, limit: number, filter: AnalyticsFilter = {}) =>
  fetchJson<TopInsight[]>(
    `/api/top-insights${buildQuery({ date, limit, ...filter })}`,
    'top insights',
  );

export const fetchRecurrenceChains = (days: number, filter: AnalyticsFilter = {}) =>
  fetchJson<RecurrenceChain[]>(
    `/api/recurrence-chains${buildQuery({ days, ...filter })}`,
    'recurrence chains',
  );

export const fetchCrossProject = (date: string, filter: AnalyticsFilter = {}) =>
  fetchJson<ProjectRollup[]>(
    `/api/cross-project${buildQuery({ date, ...filter })}`,
    'cross-project rollup',
  );

export const fetchEffortBreakdown = (date: string, filter: AnalyticsFilter = {}) =>
  fetchJson<EffortBreakdown>(
    `/api/effort-breakdown${buildQuery({ date, ...filter })}`,
    'effort breakdown',
  );

export const fetchEffortBreakdownTrend = (days: number, filter: AnalyticsFilter = {}) =>
  fetchJson<EffortBreakdownTrendPoint[]>(
    `/api/effort-breakdown-trend${buildQuery({ days, ...filter })}`,
    'effort breakdown trend',
  );

export const fetchEffortByCategory = (date: string, filter: AnalyticsFilter = {}) =>
  fetchJson<EffortByCategoryPoint[]>(
    `/api/effort-by-category${buildQuery({ date, ...filter })}`,
    'effort by category',
  );

export const fetchLabels = () => fetchJson<LabelSummary[]>('/api/labels', 'labels');

export const fetchProjects = () => fetchJson<ProjectSummary[]>('/api/projects', 'projects');

export const fetchSessions = (project?: string) =>
  fetchJson<SessionSummary[]>(`/api/sessions${buildQuery({ project })}`, 'sessions');

export const fetchSessionProjects = () =>
  fetchJson<SessionProject[]>('/api/session-projects', 'session projects');

export const fetchSessionsAll = (projectDir: string, page = 1, pageSize = 20) =>
  fetchJson<PaginatedSessions>(
    `/api/sessions/all${buildQuery({ project: projectDir, page, pageSize })}`,
    'all sessions',
  );

export const fetchSessionRuns = (projectDir: string, sessionId: string) =>
  fetchJson<SessionRun[]>(
    `/api/session-runs${buildQuery({ project: projectDir, session: sessionId })}`,
    'session runs',
  );

export async function postAnalyzeSession(
  projectDir: string,
  sessionId: string,
  label?: string,
): Promise<{ jobId: string }> {
  const res = await fetch('/api/sessions/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDir, sessionId, label }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(data.error || 'Failed to start analysis');
  }
  return res.json();
}

export const fetchAnalyzeJob = (jobId: string) =>
  fetchJson<AnalyzeJob>(`/api/sessions/analyze/${encodeURIComponent(jobId)}`, 'analyze job');

export async function postLabel(
  projectDir: string,
  sessionId: string,
  oldLabel: string,
  label: string,
): Promise<{ ok: boolean; changes: number }> {
  const res = await fetch('/api/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDir, sessionId, oldLabel, label }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(data.error || 'Failed to update label');
  }
  return res.json();
}
