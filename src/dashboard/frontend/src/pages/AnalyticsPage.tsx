import { useCallback, useEffect, useState } from 'react';
import type { Route } from '../hooks/useRoute';
import type {
  AnalyticsFilter,
  CategoryTrendPoint,
  EffortBreakdown,
  EffortBreakdownTrendPoint,
  EffortByCategoryPoint,
  ProjectRollup as ProjectRollupType,
  RecurrenceChain,
  TopInsight,
} from '../types';
import {
  fetchCategoryTrend,
  fetchCrossProject,
  fetchDates,
  fetchEffortBreakdown,
  fetchEffortBreakdownTrend,
  fetchEffortByCategory,
  fetchRecurrenceChains,
  fetchTopInsights,
} from '../api';
import { StatStrip } from '../components/StatStrip';
import { EffortBreakdownChart } from '../components/EffortBreakdownChart';
import { CategoryTrendChart } from '../components/CategoryTrendChart';
import { EffortTrendChart } from '../components/EffortTrendChart';
import { InsightList } from '../components/InsightList';
import { RecurrenceChains } from '../components/RecurrenceChains';
import { ProjectRollup } from '../components/ProjectRollup';

interface Props {
  filter: AnalyticsFilter;
  scopeLabel: string;
  route: Route;
}

const FULL_INSIGHTS_LIMIT = 1000;
const TREND_DAYS = 30;

function daysSinceDate(dateStr: string): number {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const diffMs = Date.parse(`${todayKey}T00:00:00`) - Date.parse(`${dateStr}T00:00:00`);
  return Math.max(1, Math.round(diffMs / 86400000) + 1);
}

export function AnalyticsPage({ filter, scopeLabel, route }: Props) {
  const [date, setDate] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [categoryTrend, setCategoryTrend] = useState<CategoryTrendPoint[]>([]);
  const [topInsights, setTopInsights] = useState<TopInsight[]>([]);
  const [recurrenceChains, setRecurrenceChains] = useState<RecurrenceChain[]>([]);
  const [crossProject, setCrossProject] = useState<ProjectRollupType[]>([]);
  const [effortBreakdown, setEffortBreakdown] = useState<EffortBreakdown | null>(null);
  const [effortTrend, setEffortTrend] = useState<EffortBreakdownTrendPoint[]>([]);
  const [effortByCategory, setEffortByCategory] = useState<EffortByCategoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    let cancelled = false;
    fetchDates(filter)
      .then((d) => {
        if (cancelled) return;
        setDates(d);
        setDate((prev) => (prev && d.includes(prev) ? prev : (d[0] ?? null)));
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // filterKey is a stable JSON-stringified proxy for filter's identity;
    // intentionally excluding `filter` itself to avoid re-running on every
    // render (filter is a fresh object each render since it's derived from
    // the route in App.tsx).
  }, [filterKey]);

  const isScopedToSession = route.kind === 'session' || route.kind === 'session-run';
  const trendDays =
    isScopedToSession && dates.length > 0
      ? Math.min(TREND_DAYS, daysSinceDate(dates[dates.length - 1]))
      : TREND_DAYS;

  const reload = useCallback(() => {
    if (!date) return;
    setError(null);
    Promise.all([
      fetchCategoryTrend(trendDays, filter),
      fetchTopInsights(date, FULL_INSIGHTS_LIMIT, filter),
      fetchRecurrenceChains(trendDays, filter),
      fetchCrossProject(date, filter),
      fetchEffortBreakdown(date, filter),
      fetchEffortBreakdownTrend(trendDays, filter),
      fetchEffortByCategory(date, filter),
    ])
      .then(
        ([
          categoryTrendRes,
          topInsightsRes,
          recurrenceChainsRes,
          crossProjectRes,
          effortBreakdownRes,
          effortTrendRes,
          effortByCategoryRes,
        ]) => {
          setCategoryTrend(categoryTrendRes);
          setTopInsights(topInsightsRes);
          setRecurrenceChains(recurrenceChainsRes);
          setCrossProject(crossProjectRes);
          setEffortBreakdown(effortBreakdownRes);
          setEffortTrend(effortTrendRes);
          setEffortByCategory(effortByCategoryRes);
        },
      )
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load data'));
    // Same filterKey rationale as above; trendDays is derived from dates which changes with filterKey.
  }, [date, filterKey, trendDays]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) {
    return <div className="error-banner">Failed to load dashboard: {error}</div>;
  }

  if (dates.length === 0) {
    return (
      <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
        No data yet for {scopeLabel} — run `pensieve analyze` first.
      </div>
    );
  }

  if (!effortBreakdown) {
    return null;
  }

  const isHolistic = route.kind === 'holistic';

  return (
    <>
      <main className="analytics-grid">
        <StatStrip effortBreakdown={effortBreakdown} topInsights={topInsights} />

        <section className="card">
          <h2>
            Effort Breakdown
            <span className="card-hint">today</span>
          </h2>
          <EffortBreakdownChart data={effortBreakdown} byCategory={effortByCategory} />
        </section>

        <section className="card">
          <h2>
            Toil Over Time
            <span className="card-hint">
              last {trendDays} day{trendDays === 1 ? '' : 's'}
            </span>
          </h2>
          <EffortTrendChart data={effortTrend} />
        </section>

        <section className="card span-full">
          <h2>
            Category Trend
            <span className="card-hint">
              last {trendDays} day{trendDays === 1 ? '' : 's'}
            </span>
          </h2>
          <CategoryTrendChart data={categoryTrend} />
        </section>

        <section className="card span-full">
          <h2>All Insights</h2>
          <InsightList insights={topInsights} onLabelSaved={reload} />
        </section>

        <section className="card span-full">
          <h2>Recurring Patterns</h2>
          <RecurrenceChains chains={recurrenceChains} />
        </section>

        {isHolistic && crossProject.length > 1 && (
          <section className="card span-full">
            <h2>By Project</h2>
            <ProjectRollup projects={crossProject} />
          </section>
        )}
      </main>
    </>
  );
}
